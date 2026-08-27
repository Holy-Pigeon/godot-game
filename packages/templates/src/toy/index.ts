/**
 * 玩具模板（docs/15 §3.4）：两人、一轮、投票即结束。
 *
 * 它唯一的作用是证明内核没有偷偷依赖 T-11。没有它，抽象接口迟早会退化成
 * 「T-11 的另一个名字」。它属于测试资产，不属于内容。
 *
 * 因此这里刻意用满内核契约的每一条：开局随机、命令校验、自动推进、
 * 结算声明、三张绑定表——但没有一个 T-11 的词。
 */

import {
  accept,
  corpusEvent,
  mutableSeat,
  PUBLIC,
  reject,
  ruleEvent,
  selfOnly,
  type AnchorBindings,
  type Command,
  type DeepReadonly,
  type EventDraft,
  type EventRecord,
  type KernelState,
  type PhaseDeclaration,
  type PredicateBindings,
  type SeatId,
  type SettlementDeclaration,
  type Template,
  type TemplateContext,
  type TraumaBindings,
  type Validation,
} from '@terminus/kernel'

export interface ToyVote {
  readonly seat: SeatId
  readonly approve: boolean
}

export interface ToyState {
  /** 按 seat 升序，禁止依赖插入顺序。 */
  votes: ToyVote[]
  /** 开局随机决定，结果写进事件载荷。 */
  firstSpeaker: SeatId | null
  settled: boolean
}

export const TOY_PHASES = {
  opening: 'toy.opening',
  vote: 'toy.vote',
  settlement: 'toy.settlement',
  done: 'toy.done',
} as const

export const TOY_EVENTS = {
  opened: 'toy.opened',
  speech: 'toy.speech',
  voteOpened: 'toy.voteOpened',
  voteLocked: 'toy.voteLocked',
  votesRevealed: 'toy.votesRevealed',
  settled: 'toy.settled',
} as const

export const TOY_COMMANDS = {
  lockVote: 'toy.lockVote',
  speak: 'toy.speak',
} as const

/** 一致通过时每人扣的余命，整数日。 */
const UNANIMOUS_COST = 1

export class ToyTemplate implements Template<ToyState> {
  readonly id = 'toy'
  readonly seatRange = { min: 2, max: 2 }

  phases(): readonly PhaseDeclaration[] {
    return [
      { id: TOY_PHASES.opening, label: '开场', accepts: [], advance: { kind: 'immediate' } },
      {
        id: TOY_PHASES.vote,
        label: '投票',
        accepts: [TOY_COMMANDS.lockVote, TOY_COMMANDS.speak],
        advance: { kind: 'awaitCommands' },
      },
      { id: TOY_PHASES.settlement, label: '结算', accepts: [], advance: { kind: 'immediate' } },
      { id: TOY_PHASES.done, label: '结束', accepts: [], advance: { kind: 'immediate' } },
    ]
  }

  initialState(): ToyState {
    return { votes: [], firstSpeaker: null, settled: false }
  }

  open(state: DeepReadonly<KernelState<ToyState>>, ctx: TemplateContext): readonly EventDraft[] {
    // 随机结果写进事件载荷；重放时只读载荷，不重新抽取（docs/15 §2.4 第 2 条）
    const seats = state.seats.map((s) => s.id)
    const firstSpeaker = ctx.random.pick(seats)
    return [ruleEvent(TOY_EVENTS.opened, { firstSpeaker }, PUBLIC)]
  }

  validate(state: DeepReadonly<KernelState<ToyState>>, cmd: Command): Validation {
    if (cmd.actor === null) return reject('命令必须有行动者')

    if (cmd.type === TOY_COMMANDS.speak) {
      const { text } = cmd.payload as { text?: unknown }
      if (typeof text !== 'string' || text.length === 0) return reject('发言内容不能为空')
      return accept
    }

    if (cmd.type !== TOY_COMMANDS.lockVote) return reject(`未知命令 ${cmd.type}`)
    const seat = state.seats.find((s) => s.id === cmd.actor)
    if (seat === undefined) return reject(`座位不存在：${String(cmd.actor)}`)
    if (seat.fallen) return reject('失守者不能投票')
    if (state.template.votes.some((v) => v.seat === cmd.actor)) return reject('本轮已投过票')
    const payload = cmd.payload as { approve?: unknown }
    if (typeof payload.approve !== 'boolean') return reject('approve 必须是布尔值')
    return accept
  }

  produce(
    _state: DeepReadonly<KernelState<ToyState>>,
    cmd: Command,
    _ctx: TemplateContext,
  ): readonly EventDraft[] {
    const actor = cmd.actor as SeatId

    // 行为语料流：全部公开发言进语料流，不进任何判定（docs/13 隔离第 1 条）。
    // reduce 对本类事件不做任何状态改动——这正是「删掉语料流后重放结果一致」的实现。
    if (cmd.type === TOY_COMMANDS.speak) {
      const { text } = cmd.payload as { text: string }
      return [corpusEvent(TOY_EVENTS.speech, { seat: actor, text }, PUBLIC, actor)]
    }

    const { approve } = cmd.payload as { approve: boolean }
    // 锁定前的投票仅本人可见（docs/15 §8）
    return [ruleEvent(TOY_EVENTS.voteLocked, { seat: actor, approve }, selfOnly(actor), actor)]
  }

  advance(state: DeepReadonly<KernelState<ToyState>>, _ctx: TemplateContext): readonly EventDraft[] {
    const t = state.template

    if (state.phase === TOY_PHASES.opening) {
      return [ruleEvent(TOY_EVENTS.voteOpened, {}, PUBLIC)]
    }

    if (state.phase === TOY_PHASES.vote) {
      const living = state.seats.filter((s) => !s.fallen)
      if (t.votes.length < living.length) return []
      // 全员锁定，转公开
      return [ruleEvent(TOY_EVENTS.votesRevealed, { votes: t.votes.map((v) => ({ ...v })) }, PUBLIC)]
    }

    if (state.phase === TOY_PHASES.settlement) {
      const unanimous = t.votes.length > 0 && t.votes.every((v) => v.approve)
      const losses = state.seats
        .filter((s) => !s.fallen)
        .map((s) => ({
          seat: s.id,
          // 实际扣除值：归零截断后的，不是名义值（docs/15 §6）
          actualLoss: unanimous ? Math.min(UNANIMOUS_COST, s.lifespan) : 0,
        }))
      return [ruleEvent(TOY_EVENTS.settled, { unanimous, losses }, PUBLIC)]
    }

    return []
  }

  reduce(state: KernelState<ToyState>, event: EventRecord): void {
    switch (event.type) {
      case TOY_EVENTS.opened: {
        const { firstSpeaker } = event.payload as { firstSpeaker: SeatId }
        state.template.firstSpeaker = firstSpeaker
        break
      }
      case TOY_EVENTS.voteOpened: {
        state.phase = TOY_PHASES.vote
        state.levelRound = 1
        state.negotiationRound = 1
        break
      }
      case TOY_EVENTS.voteLocked: {
        const vote = event.payload as ToyVote
        state.template.votes.push({ ...vote })
        state.template.votes.sort((a, b) => a.seat - b.seat)
        break
      }
      case TOY_EVENTS.votesRevealed: {
        state.phase = TOY_PHASES.settlement
        break
      }
      case TOY_EVENTS.settled: {
        const { losses } = event.payload as { losses: readonly { seat: SeatId; actualLoss: number }[] }
        for (const { seat, actualLoss } of losses) {
          const s = mutableSeat(state, seat)
          s.lifespan -= actualLoss
          if (s.lifespan <= 0) {
            s.lifespan = 0
            s.fallen = true
          }
        }
        state.template.settled = true
        state.phase = TOY_PHASES.done
        break
      }
    }
  }

  isComplete(state: DeepReadonly<KernelState<ToyState>>): boolean {
    return state.phase === TOY_PHASES.done
  }

  settlement(): SettlementDeclaration {
    return {
      ticketPerSeat: 0,
      recoveryEventTypes: [TOY_EVENTS.settled],
      awardEventTypes: [],
      deathEventType: TOY_EVENTS.settled,
      deathEquivalent: 10,
    }
  }

  /** 玩具模板不绑定任何谓词——它同时充当「合法降级」的测试样本（docs/15 §3.3）。 */
  predicateBindings(): PredicateBindings {
    return {}
  }

  /** 锚点注册表存在但为空（docs/15 §5 MVP 第 1 条）。 */
  anchorBindings(): AnchorBindings {
    return {}
  }

  traumaBindings(): TraumaBindings {
    return [{ eventType: TOY_EVENTS.settled, feeds: ['W2'], note: '玩具模板的唯一损失来源' }]
  }
}
