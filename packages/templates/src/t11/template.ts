/**
 * T-11「最后提案」主模板。
 *
 * 规则真源 docs/12，结构安排 docs/15 §7。
 */

import {
  PUBLIC,
  SERVER_ONLY,
  accept,
  corpusEvent,
  mutableSeat,
  reject,
  ruleEvent,
  selfOnly,
  toSeats,
  type AnchorBindings,
  type Command,
  type DeepReadonly,
  type EventDraft,
  type EventRecord,
  type KernelState,
  type PhaseDeclaration,
  type PredicateBindings,
  type SeatId,
  type SeededRandom,
  type SettlementDeclaration,
  type Template,
  type TemplateContext,
  type TraumaBindings,
  type Validation,
} from '@terminus/kernel'
import { gateConditionsMet, hiddenReactions, perfectClearPercent, reduceHidden } from './hidden.ts'
import {
  MANDATE_BY_ID,
  T11_MANDATES,
  mandateAwardOf,
  type LossSettledPayload,
  type MandateDifficulty,
  type TransferRespondedPayload,
} from './mandates.ts'
import { buildPredicateBindings } from './predicates.ts'
import {
  T11_COMMANDS,
  T11_DEFAULT_PARAMS,
  T11_EVENTS,
  T11_PHASES,
  actOfRound,
  addTally,
  baseLossOfRound,
  lossPerMark,
  marksHeldBy,
  tallyOf,
  unallocatedMarks,
  type T11MandateAssignment,
  type T11Params,
  type T11EndgameReason,
  type T11State,
  type T11Vote,
} from './types.ts'

// ─────────────────────────── 状态读取辅助 ───────────────────────────

function livingIds(state: DeepReadonly<KernelState<T11State>>): readonly SeatId[] {
  return state.seats.filter((s) => !s.fallen).map((s) => s.id)
}

function lifespanOf(state: DeepReadonly<KernelState<T11State>>, seat: SeatId): number {
  return state.seats.find((s) => s.id === seat)?.lifespan ?? 0
}

/**
 * 第一协商轮的首位行动者按座次轮换：第 1 关卡轮从座位 1 开始，第 2 轮从座位 2 开始（docs/12）。
 * 轮到的座位若已失守则顺延到下一个仍存活的座位。
 */
function roundFirstActor(state: DeepReadonly<KernelState<T11State>>, levelRound: number): SeatId {
  const all = state.seats.map((s) => s.id)
  const living = livingIds(state)
  if (living.length === 0) throw new Error('没有存活座位')
  const start = (levelRound - 1) % all.length
  for (let i = 0; i < all.length; i++) {
    const candidate = all[(start + i) % all.length]
    if (candidate !== undefined && living.includes(candidate)) return candidate
  }
  throw new Error('找不到存活的首位行动者')
}

/** 否决后顺延一个仍存活座位，避免同一玩家持续拥有先手（docs/12）。 */
function nextFirstActor(state: DeepReadonly<KernelState<T11State>>, current: SeatId | null): SeatId {
  const living = livingIds(state)
  if (living.length === 0) throw new Error('没有存活座位')
  if (current === null) return living[0] as SeatId
  const index = living.indexOf(current)
  if (index === -1) {
    // 原首位已失守：取座次上紧随其后的存活座位
    const after = living.find((id) => id > current)
    return after ?? (living[0] as SeatId)
  }
  return living[(index + 1) % living.length] as SeatId
}

/** 从首位行动者起算的存活座位环形序列。 */
function actionOrderFrom(state: DeepReadonly<KernelState<T11State>>, firstActor: SeatId): SeatId[] {
  const living = [...livingIds(state)]
  const index = living.indexOf(firstActor)
  if (index === -1) return living
  return [...living.slice(index), ...living.slice(0, index)]
}

function currentActor(state: DeepReadonly<KernelState<T11State>>): SeatId | undefined {
  const t = state.template
  return t.actionOrder[t.actionCursor]
}

// ─────────────────────────── 发令器（docs/15 §7.6） ───────────────────────────

/** 每个难度分到的条数。6 人为 2 / 2 / 2（docs/12 固定抽取）。 */
function mandateQuota(seatCount: number): Record<MandateDifficulty, number> {
  const base = Math.floor(seatCount / 3)
  const quota: Record<MandateDifficulty, number> = { low: base, mid: base, high: base }
  const order: readonly MandateDifficulty[] = ['low', 'mid', 'high']
  for (let i = 0; i < seatCount - base * 3; i++) {
    const key = order[i]
    if (key !== undefined) quota[key] += 1
  }
  return quota
}

/**
 * 抽取密令。
 *
 * docs/12：发令器必须排除天然完成、完全重复或因目标状态不可能完成的组合。
 * MVP 实现三条：同一条密令不发两次（不放回抽取）；带 X 的密令目标不指向自己；
 * 难度配额固定。更复杂的可达性校验属于 docs/03「分配前执行可达性校验」，不在 MVP 范围。
 */
function dealMandates(seats: readonly SeatId[], random: SeededRandom): T11MandateAssignment[] {
  const quota = mandateQuota(seats.length)
  const picked = (['low', 'mid', 'high'] as const).flatMap((difficulty) =>
    random.sample(
      T11_MANDATES.filter((m) => m.difficulty === difficulty),
      quota[difficulty],
    ),
  )

  const holders = random.shuffled(seats)
  return picked
    .map((definition, index) => {
      const seat = holders[index]
      if (seat === undefined) throw new Error('密令数与座位数不匹配')
      const others = seats.filter((s) => s !== seat)
      const target = definition.needsTarget ? random.pick(others) : null
      return { seat, mandateId: definition.id, target }
    })
    .sort((a, b) => a.seat - b.seat)
}

// ─────────────────────────── 模板 ───────────────────────────

export class T11Template implements Template<T11State> {
  readonly id = 't11'
  /** docs/12：6 人；扩展测试可用 4–8 人，参数另测。 */
  readonly seatRange = { min: 4, max: 8 }

  readonly #params: T11Params

  constructor(params: T11Params = T11_DEFAULT_PARAMS) {
    this.#params = params
  }

  phases(): readonly PhaseDeclaration[] {
    const chat = [T11_COMMANDS.speak, T11_COMMANDS.whisper]
    const p = this.#params
    return [
      {
        id: T11_PHASES.disasterReveal,
        label: '灾难显现',
        accepts: chat,
        advance: { kind: 'immediate' },
      },
      {
        id: T11_PHASES.sequentialAction,
        label: '顺序行动',
        accepts: [
          T11_COMMANDS.assumeMark,
          T11_COMMANDS.requestTransfer,
          T11_COMMANDS.respondTransfer,
          T11_COMMANDS.pass,
          T11_COMMANDS.timeout,
          ...chat,
        ],
        advance: { kind: 'timed', timeoutMs: p.sequentialActionMs },
      },
      {
        id: T11_PHASES.allocationCheck,
        label: '分配检查',
        accepts: chat,
        advance: { kind: 'immediate' },
      },
      {
        id: T11_PHASES.echoWindowAllocation,
        label: '分配回响窗口',
        accepts: chat,
        advance: { kind: 'immediate' },
      },
      {
        id: T11_PHASES.freeExchange,
        label: '自由交流',
        accepts: [T11_COMMANDS.commitApproval, T11_COMMANDS.ready, T11_COMMANDS.timeout, ...chat],
        advance: { kind: 'timed', timeoutMs: p.freeExchangeMs },
      },
      {
        id: T11_PHASES.approvalVote,
        label: '认可投票',
        accepts: [T11_COMMANDS.lockVote, T11_COMMANDS.timeout, ...chat],
        advance: { kind: 'timed', timeoutMs: p.approvalVoteMs },
      },
      {
        id: T11_PHASES.echoWindowInformation,
        label: '信息回响窗口',
        accepts: chat,
        advance: { kind: 'immediate' },
      },
      { id: T11_PHASES.voteReveal, label: '投票揭晓', accepts: chat, advance: { kind: 'immediate' } },
      {
        id: T11_PHASES.settlementOrVeto,
        label: '结算与否决',
        accepts: chat,
        advance: { kind: 'immediate' },
      },
      {
        id: T11_PHASES.finalSettlement,
        label: '终局结算',
        accepts: chat,
        advance: { kind: 'immediate' },
      },
      { id: T11_PHASES.done, label: '关卡结束', accepts: [], advance: { kind: 'immediate' } },
    ]
  }

  initialState(seats: readonly SeatId[]): T11State {
    return {
      params: this.#params,
      marks: [],
      actionOrder: [],
      actionCursor: 0,
      pending: null,
      commitments: [],
      ready: [],
      votes: [],
      lastVerdict: null,
      currentFirstActor: null,
      roundVetoes: 0,
      totalVetoes: 0,
      burden: seats.map((seat) => ({ seat, value: 0 })),
      settledMarkCount: seats.map((seat) => ({ seat, value: 0 })),
      entryLifespan: seats.map((seat) => ({ seat, value: 0 })),
      mandates: [],
      endgame: null,
      finalAwardPaid: false,
      mandatesEvaluated: false,
      mandateVerdicts: [],
      markLossPaid: seats.map((seat) => ({ seat, value: 0 })),
      ticketPaid: seats.map((seat) => ({ seat, value: 0 })),
      hidden: {
        lamps: [],
        coDecisionRounds: 0,
        gateRingTurns: 0,
        ringPulsedThisRound: false,
        cracksClosedThisRound: [],
        fallenThisRound: false,
        gateConditionsMetThisRound: false,
      },
    }
  }

  open(state: DeepReadonly<KernelState<T11State>>, ctx: TemplateContext): readonly EventDraft[] {
    const p = this.#params
    const seats = state.seats.map((s) => s.id)

    const drafts: EventDraft[] = [
      ruleEvent(
        T11_EVENTS.matchStarted,
        {
          seats: state.seats.map((s) => ({ seat: s.id, entryLifespan: s.lifespan })),
          ticketPerSeat: p.ticketPerSeat,
          levelRounds: p.levelRounds,
          marksPerRound: p.marksPerRound,
        },
        PUBLIC,
      ),
      // 玩家支付门票后带入真实剩余余命（docs/12）。门票走事件流，
      // 否则 docs/02 的回收等级与系统净回收无法从事件流复算。
      ruleEvent(
        T11_EVENTS.ticketCharged,
        {
          entries: state.seats.map((s) => ({
            seat: s.id,
            amount: Math.min(p.ticketPerSeat, s.lifespan),
          })),
        },
        PUBLIC,
      ),
    ]

    // 抽取结果先写成事件；密令只对本人可见（docs/15 §7.6）
    for (const assignment of dealMandates(seats, ctx.random)) {
      drafts.push(
        ruleEvent(T11_EVENTS.mandateDealt, assignment, selfOnly(assignment.seat), assignment.seat),
      )
    }

    return drafts
  }

  validate(state: DeepReadonly<KernelState<T11State>>, cmd: Command): Validation {
    const t = state.template

    // 超时由会话层注入，没有行动者
    if (cmd.type === T11_COMMANDS.timeout) {
      return cmd.actor === null ? accept : reject('超时命令不得带行动者')
    }

    if (cmd.actor === null) return reject('该命令必须有行动者')
    const actor = cmd.actor
    const seat = state.seats.find((s) => s.id === actor)
    if (seat === undefined) return reject(`座位不存在：${actor}`)
    if (seat.fallen) return reject('失守者不能再行动、持有灾痕、投票或获奖')

    // 语料流命令不受规则层时序约束
    if (cmd.type === T11_COMMANDS.speak || cmd.type === T11_COMMANDS.whisper) {
      const { text } = cmd.payload as { text?: unknown }
      if (typeof text !== 'string' || text.trim().length === 0) return reject('发言内容不能为空')
      if (cmd.type === T11_COMMANDS.whisper) {
        const { to } = cmd.payload as { to?: unknown }
        if (!Array.isArray(to) || to.length === 0) return reject('私聊必须指定接收者')
        if (to.some((id) => !state.seats.some((s) => s.id === id))) return reject('私聊接收者不存在')
      }
      return accept
    }

    // 待回应期间只接受被申请者的回应，其余规则层命令一律拒绝（docs/15 §7.2）
    if (t.pending !== null) {
      if (cmd.type !== T11_COMMANDS.respondTransfer) {
        return reject('正在等待被申请者回应转移申请')
      }
      if (actor !== t.pending.holder) return reject('只有被申请者可以回应')
      const { accepted } = cmd.payload as { accepted?: unknown }
      if (typeof accepted !== 'boolean') return reject('accepted 必须是布尔值')
      return accept
    }

    switch (cmd.type) {
      case T11_COMMANDS.respondTransfer:
        return reject('当前没有待回应的转移申请')

      case T11_COMMANDS.assumeMark: {
        if (currentActor(state) !== actor) return reject('还没轮到你行动')
        const { markId } = cmd.payload as { markId?: unknown }
        if (typeof markId !== 'number') return reject('markId 必须是数字')
        const mark = t.marks.find((m) => m.id === markId)
        if (mark === undefined) return reject(`灾痕不存在：${markId}`)
        if (mark.holder !== null) return reject('该灾痕已经有人承担')
        if (marksHeldBy(t.marks, actor).length >= t.params.maxMarksPerSeat) {
          return reject(`每人最多持有 ${t.params.maxMarksPerSeat} 枚灾痕`)
        }
        return accept
      }

      case T11_COMMANDS.requestTransfer: {
        if (currentActor(state) !== actor) return reject('还没轮到你行动')
        const { markId } = cmd.payload as { markId?: unknown }
        if (typeof markId !== 'number') return reject('markId 必须是数字')
        const mark = t.marks.find((m) => m.id === markId)
        if (mark === undefined) return reject(`灾痕不存在：${markId}`)
        if (mark.holder === null) return reject('该灾痕无人持有，应当直接承担')
        if (mark.holder === actor) return reject('不能向自己申请转移')
        if (!livingIds(state).includes(mark.holder)) return reject('持有者已失守')
        if (marksHeldBy(t.marks, actor).length >= t.params.maxMarksPerSeat) {
          return reject(`已持有 ${t.params.maxMarksPerSeat} 枚，不能再申请转入`)
        }
        return accept
      }

      case T11_COMMANDS.pass:
        if (currentActor(state) !== actor) return reject('还没轮到你行动')
        return accept

      case T11_COMMANDS.commitApproval:
        // 每人每协商轮最多一次，一旦发出不可撤回（docs/12）
        if (t.commitments.includes(actor)) return reject('本协商轮已经公开承诺过')
        return accept

      case T11_COMMANDS.ready:
        if (t.ready.includes(actor)) return reject('已经就绪')
        return accept

      case T11_COMMANDS.lockVote: {
        if (t.votes.some((v) => v.seat === actor)) return reject('本协商轮已经锁定过投票')
        const { approve } = cmd.payload as { approve?: unknown }
        if (typeof approve !== 'boolean') return reject('approve 必须是布尔值')
        return accept
      }

      default:
        return reject(`未知命令 ${cmd.type}`)
    }
  }

  produce(
    state: DeepReadonly<KernelState<T11State>>,
    cmd: Command,
    _ctx: TemplateContext,
  ): readonly EventDraft[] {
    const t = state.template

    if (cmd.type === T11_COMMANDS.timeout) return this.#timeoutDrafts(state)

    const actor = cmd.actor as SeatId

    switch (cmd.type) {
      case T11_COMMANDS.speak: {
        const { text } = cmd.payload as { text: string }
        return [corpusEvent(T11_EVENTS.publicSpeech, { seat: actor, text }, PUBLIC, actor)]
      }

      case T11_COMMANDS.whisper: {
        const { to, text } = cmd.payload as { to: readonly SeatId[]; text: string }
        // 私聊全部记录，含收发双方与时点（docs/13）
        return [
          corpusEvent(
            T11_EVENTS.privateMessage,
            { from: actor, to: [...to].sort((a, b) => a - b), text },
            toSeats([actor, ...to]),
            actor,
          ),
        ]
      }

      case T11_COMMANDS.assumeMark: {
        const { markId } = cmd.payload as { markId: number }
        return [
          ruleEvent(
            T11_EVENTS.markAssumed,
            { seat: actor, markId, source: 'voluntary' },
            PUBLIC,
            actor,
          ),
        ]
      }

      case T11_COMMANDS.requestTransfer: {
        const { markId } = cmd.payload as { markId: number }
        const holder = t.marks.find((m) => m.id === markId)?.holder as SeatId
        return [
          ruleEvent(
            T11_EVENTS.transferRequested,
            { requester: actor, holder, markId },
            PUBLIC,
            actor,
          ),
        ]
      }

      case T11_COMMANDS.respondTransfer: {
        const { accepted } = cmd.payload as { accepted: boolean }
        const pending = t.pending
        if (pending === null) throw new Error('校验与产出不一致：没有待回应的转移申请')
        const drafts: EventDraft[] = [
          ruleEvent(
            T11_EVENTS.transferResponded,
            { requester: pending.requester, holder: pending.holder, markId: pending.markId, accepted },
            PUBLIC,
            actor,
          ),
        ]
        if (accepted) {
          drafts.push(
            ruleEvent(
              T11_EVENTS.markTransferred,
              {
                markId: pending.markId,
                from: pending.holder,
                to: pending.requester,
                source: 'voluntary',
              },
              PUBLIC,
              actor,
            ),
          )
        }
        return drafts
      }

      case T11_COMMANDS.pass:
        return [ruleEvent(T11_EVENTS.actionPassed, { seat: actor }, PUBLIC, actor)]

      case T11_COMMANDS.commitApproval:
        // 全场立即可见并写入规则事件流。聊天框里说「我认可」不构成公开承诺（docs/12）
        return [ruleEvent(T11_EVENTS.approvalCommitted, { seat: actor }, PUBLIC, actor)]

      case T11_COMMANDS.ready:
        return [ruleEvent(T11_EVENTS.exchangeReady, { seat: actor }, PUBLIC, actor)]

      case T11_COMMANDS.lockVote: {
        const { approve } = cmd.payload as { approve: boolean }
        // 锁定前仅本人可见；揭晓时才转公开（docs/15 §8）
        return [
          ruleEvent(T11_EVENTS.voteLocked, { seat: actor, approve }, selfOnly(actor), actor),
        ]
      }

      default:
        throw new Error(`产出未覆盖命令 ${cmd.type}`)
    }
  }

  /**
   * 超时的三种处理。
   *
   * ⚠ docs/12 只写了「全员锁定或超时」，没有规定超时时未提交者按什么处理。
   * 这里的取值是实现判读，不是文档规则：
   *   - 顺序行动：当前座位视为不选（docs/12 本就有「不选」这个动作）
   *   - 自由交流：未就绪者视为就绪
   *   - 认可投票：未锁定者视为反对——不让沉默推动方案通过
   */
  #timeoutDrafts(state: DeepReadonly<KernelState<T11State>>): readonly EventDraft[] {
    const t = state.template
    const living = livingIds(state)

    if (state.phase === T11_PHASES.sequentialAction) {
      if (t.pending !== null) {
        // 待回应超时按拒绝处理，保持原状
        return [
          ruleEvent(
            T11_EVENTS.transferResponded,
            {
              requester: t.pending.requester,
              holder: t.pending.holder,
              markId: t.pending.markId,
              accepted: false,
            },
            PUBLIC,
            t.pending.holder,
          ),
        ]
      }
      const actor = currentActor(state)
      if (actor === undefined) return []
      return [ruleEvent(T11_EVENTS.actionTimedOut, { seat: actor }, PUBLIC, actor)]
    }

    if (state.phase === T11_PHASES.freeExchange) {
      return living
        .filter((seat) => !t.ready.includes(seat))
        .map((seat) => ruleEvent(T11_EVENTS.exchangeReady, { seat }, PUBLIC, seat))
    }

    if (state.phase === T11_PHASES.approvalVote) {
      return living
        .filter((seat) => !t.votes.some((v) => v.seat === seat))
        .map((seat) =>
          ruleEvent(T11_EVENTS.voteLocked, { seat, approve: false }, selfOnly(seat), seat),
        )
    }

    return []
  }

  advance(state: DeepReadonly<KernelState<T11State>>, ctx: TemplateContext): readonly EventDraft[] {
    // 潜规则层的世界内反馈优先落地：它们是已发生事实的回声，
    // 且门环三条件依赖参与灯已经点亮
    const reactions = hiddenReactions(state, ctx.facts)
    if (reactions.length > 0) return reactions

    switch (state.phase) {
      case T11_PHASES.disasterReveal:
        return this.#openLevelRound(state)

      case T11_PHASES.sequentialAction: {
        const t = state.template
        if (t.pending !== null) return []
        if (t.actionCursor < t.actionOrder.length) return []
        return [phaseEntered(T11_PHASES.allocationCheck)]
      }

      case T11_PHASES.allocationCheck: {
        const unallocated = unallocatedMarks(state.template.marks).map((m) => m.id)
        return [
          ruleEvent(
            T11_EVENTS.allocationChecked,
            { allocated: unallocated.length === 0, unallocatedIds: unallocated },
            PUBLIC,
          ),
          phaseEntered(T11_PHASES.echoWindowAllocation),
        ]
      }

      // MVP 零耗时穿过；回响接入时只是给它挂上处理器，不动状态机拓扑（docs/15 §5、§7.1）
      case T11_PHASES.echoWindowAllocation:
        return [phaseEntered(T11_PHASES.freeExchange)]

      case T11_PHASES.freeExchange: {
        const living = livingIds(state)
        if (state.template.ready.length < living.length) return []
        return [phaseEntered(T11_PHASES.approvalVote)]
      }

      case T11_PHASES.approvalVote: {
        const living = livingIds(state)
        if (state.template.votes.length < living.length) return []
        return [phaseEntered(T11_PHASES.echoWindowInformation)]
      }

      case T11_PHASES.echoWindowInformation:
        return [phaseEntered(T11_PHASES.voteReveal)]

      case T11_PHASES.voteReveal:
        return this.#reveal(state)

      case T11_PHASES.settlementOrVeto:
        return this.#settleOrVeto(state)

      case T11_PHASES.finalSettlement:
        return this.#finalize(state, ctx)

      default:
        return []
    }
  }

  #openLevelRound(state: DeepReadonly<KernelState<T11State>>): readonly EventDraft[] {
    const p = this.#params
    const round = state.levelRound + 1
    const firstActor = roundFirstActor(state, round)
    const order = actionOrderFrom(state, firstActor)

    return [
      ruleEvent(
        T11_EVENTS.levelRoundStarted,
        { levelRound: round, act: actOfRound(round), baseLoss: baseLossOfRound(round), firstActor },
        PUBLIC,
      ),
      ruleEvent(
        T11_EVENTS.marksRevealed,
        {
          markIds: Array.from({ length: p.marksPerRound }, (_, i) => i),
          baseLoss: baseLossOfRound(round),
        },
        PUBLIC,
      ),
      ruleEvent(
        T11_EVENTS.negotiationRoundStarted,
        { negotiationRound: 1, firstActor, actionOrder: order },
        PUBLIC,
      ),
      phaseEntered(T11_PHASES.sequentialAction),
    ]
  }

  /**
   * 投票揭晓（docs/12「认可投票」「投票揭晓」）。
   *
   * 全员锁定后 approvals = n − dissents，因此「至少 n−1 认可」与「反对不超过 1 张」等价，
   * 只按反对票数判即可：
   *   - 反对 ≥ 2：正式否决，无论是否分完
   *   - 反对 ≤ 1 且已分完：通过
   *   - 反对 ≤ 1 且未分完：第一协商轮无代价进入第二轮，第二轮起视为否决
   */
  #reveal(state: DeepReadonly<KernelState<T11State>>): readonly EventDraft[] {
    const t = state.template
    const votes = t.votes.map((v) => ({ seat: v.seat, approve: v.approve }))
    const dissenters = votes.filter((v) => !v.approve).map((v) => v.seat)
    const unallocated = unallocatedMarks(t.marks).map((m) => m.id)
    const allocated = unallocated.length === 0

    const drafts: EventDraft[] = [ruleEvent(T11_EVENTS.votesRevealed, { votes }, PUBLIC)]

    if (dissenters.length >= 2) {
      drafts.push(
        ruleEvent(T11_EVENTS.proposalVetoed, { reason: 'dissent', dissenters, unallocatedIds: unallocated }, PUBLIC),
      )
    } else if (allocated) {
      drafts.push(
        ruleEvent(
          T11_EVENTS.proposalPassed,
          { approvals: votes.length - dissenters.length, dissenters },
          PUBLIC,
        ),
      )
    } else if (state.negotiationRound === 1) {
      drafts.push(ruleEvent(T11_EVENTS.graceAdvance, { unallocatedIds: unallocated }, PUBLIC))
    } else {
      drafts.push(
        ruleEvent(T11_EVENTS.proposalVetoed, { reason: 'unallocated', dissenters, unallocatedIds: unallocated }, PUBLIC),
      )
    }

    drafts.push(phaseEntered(T11_PHASES.settlementOrVeto))
    return drafts
  }

  /**
   * 结算或进入下一协商轮。
   *
   * 结算严格三步且同时扣除（docs/15 §7.3）：
   *   1. 先全部算完，再一次性写入——entries 全部基于结算前的余命计算
   *   2. 立即检查归零并处理失守
   *   3. 仅终局：最终承担奖 → 密令奖（在 #finalize 里，分批提交）
   */
  #settleOrVeto(state: DeepReadonly<KernelState<T11State>>): readonly EventDraft[] {
    const t = state.template
    const p = this.#params

    if (t.lastVerdict !== 'passed') {
      // 否决或无代价推进：不清空当前分配，全员重新获得一次顺序行动
      const firstActor = nextFirstActor(state, t.currentFirstActor)
      return [
        ruleEvent(
          T11_EVENTS.negotiationRoundStarted,
          {
            negotiationRound: state.negotiationRound + 1,
            firstActor,
            actionOrder: actionOrderFrom(state, firstActor),
          },
          PUBLIC,
        ),
        phaseEntered(T11_PHASES.sequentialAction),
      ]
    }

    const loss = lossPerMark(state.levelRound, t.roundVetoes)
    const entries = livingIds(state)
      .map((seat) => {
        const held = marksHeldBy(t.marks, seat)
        const nominalLoss = held.length * loss
        return {
          seat,
          markIds: held.map((m) => m.id).sort((a, b) => a - b),
          nominalLoss,
          // 归零截断后的实际扣除值，不是名义值（docs/15 §6）
          actualLoss: Math.min(nominalLoss, lifespanOf(state, seat)),
        }
      })
      .filter((e) => e.markIds.length > 0)

    const drafts: EventDraft[] = [
      ruleEvent(
        T11_EVENTS.lossSettled,
        { levelRound: state.levelRound, lossPerMark: loss, entries } satisfies LossSettledPayload,
        PUBLIC,
      ),
    ]

    // 立即检查归零；归零不能被本轮稍后的奖励救回（docs/12）
    const fallen = entries
      .filter((e) => lifespanOf(state, e.seat) - e.actualLoss <= 0)
      .map((e) => e.seat)
    if (fallen.length > 0) {
      drafts.push(ruleEvent(T11_EVENTS.seatFallen, { seats: fallen }, PUBLIC))
    }

    drafts.push(ruleEvent(T11_EVENTS.levelRoundEnded, { levelRound: state.levelRound }, PUBLIC))

    const survivors = livingIds(state).filter((id) => !fallen.includes(id))
    const finished = state.levelRound >= p.levelRounds
    const earlyEnd = survivors.length <= p.earlyEndAtSeats

    drafts.push(phaseEntered(finished || earlyEnd ? T11_PHASES.finalSettlement : T11_PHASES.disasterReveal))
    return drafts
  }

  /**
   * 终局（docs/15 §7.5）。
   *
   * 必须拆成两步，中间隔一次提交：第一步宣告终局原因并发放最终承担奖，
   * 第二步才做密令求值——M-10【活得最少】读的是发奖后的余命。
   * 每次 advance 只返回一批，运行时的循环保证前一批已归约。
   */
  #finalize(state: DeepReadonly<KernelState<T11State>>, ctx: TemplateContext): readonly EventDraft[] {
    const t = state.template
    const p = this.#params

    if (!t.finalAwardPaid) {
      const reason = endgameReason(state, p)
      const rankings = finalBurdenRankings(state)
      return [
        // 三条路径都必须无条件留档（docs/15 §7.5）
        ruleEvent(T11_EVENTS.endgameDeclared, { reason, levelRound: state.levelRound }, PUBLIC),
        ruleEvent(
          T11_EVENTS.endgameRecorded,
          {
            reason,
            levelRound: state.levelRound,
            coDecisionRounds: t.hidden.coDecisionRounds,
            gateRingTurns: t.hidden.gateRingTurns,
          },
          SERVER_ONLY,
        ),
        ruleEvent(
          T11_EVENTS.finalBurdenAwarded,
          { totalVetoes: t.totalVetoes, rankings },
          PUBLIC,
        ),
      ]
    }

    if (!t.mandatesEvaluated) {
      return t.mandates.map((assignment) => {
        const definition = MANDATE_BY_ID.get(assignment.mandateId)
        if (definition === undefined) throw new Error(`未知密令：${assignment.mandateId}`)
        const verdict = definition.judge({
          facts: ctx.facts,
          state,
          seat: assignment.seat,
          target: assignment.target,
        })
        const award = mandateAwardOf(definition, p.mandateAward)
        const fallen = state.seats.find((s) => s.id === assignment.seat)?.fallen ?? false
        // 记录与发放分开：失守者不获奖，但判定结果仍然入档，只是发放额归零（docs/15 §7.6）
        return ruleEvent(
          T11_EVENTS.mandateEvaluated,
          {
            seat: assignment.seat,
            mandateId: assignment.mandateId,
            target: assignment.target,
            achieved: verdict.achieved,
            evidenceSeqs: verdict.evidenceSeqs,
            award,
            paid: verdict.achieved && !fallen ? award : 0,
          },
          selfOnly(assignment.seat),
          assignment.seat,
        )
      })
    }

    // 完美判定只在「打完全部轮次且所有入场玩家仍存活」时执行（docs/15 §7.5）
    if (t.endgame?.reason === 'allRoundsAllAlive') {
      const rolled = ctx.facts.lastOfType<{ success: boolean }>(T11_EVENTS.perfectClearRolled)
      if (rolled === undefined) {
        const coDecisionRounds = t.hidden.coDecisionRounds
        const probabilityPercent = perfectClearPercent(coDecisionRounds)
        const { draw, success } = ctx.random.rollPercent(probabilityPercent)
        // 四项缺任何一项都会让重放漂移（docs/15 §7.4）
        return [
          ruleEvent(
            T11_EVENTS.perfectClearRolled,
            { coDecisionRounds, probabilityPercent, draw, success },
            SERVER_ONLY,
          ),
        ]
      }
      if (rolled.payload.success && !ctx.facts.existsOfType(T11_EVENTS.perfectClearSettled)) {
        const refunds = state.seats.map((s) => ({
          seat: s.id,
          ticket: tallyOf(t.ticketPaid, s.id),
          markLoss: tallyOf(t.markLossPaid, s.id),
          bonus: s.fallen ? 0 : p.perfectClearBonus,
        }))
        return [ruleEvent(T11_EVENTS.perfectClearSettled, { refunds }, PUBLIC)]
      }
    }

    return [phaseEntered(T11_PHASES.done)]
  }

  reduce(state: KernelState<T11State>, event: EventRecord): void {
    const t = state.template

    // 潜规则层独立归约，只写 hidden 子状态
    reduceHidden(state, event.type, event.payload)

    switch (event.type) {
      case T11_EVENTS.matchStarted: {
        const { seats } = event.payload as {
          seats: readonly { seat: SeatId; entryLifespan: number }[]
        }
        for (const { seat, entryLifespan } of seats) {
          addTally(t.entryLifespan, seat, entryLifespan)
        }
        break
      }

      case T11_EVENTS.ticketCharged: {
        const { entries } = event.payload as {
          entries: readonly { seat: SeatId; amount: number }[]
        }
        for (const { seat, amount } of entries) {
          const s = mutableSeat(state, seat)
          s.lifespan -= amount
          addTally(t.ticketPaid, seat, amount)
          if (s.lifespan <= 0) {
            s.lifespan = 0
            s.fallen = true
          }
        }
        break
      }

      case T11_EVENTS.mandateDealt: {
        const assignment = event.payload as T11MandateAssignment
        t.mandates.push({ ...assignment })
        t.mandates.sort((a, b) => a.seat - b.seat)
        break
      }

      case T11_EVENTS.phaseEntered: {
        const { phase } = event.payload as { phase: string }
        state.phase = phase
        break
      }

      case T11_EVENTS.levelRoundStarted: {
        const { levelRound, firstActor } = event.payload as {
          levelRound: number
          firstActor: SeatId
        }
        state.levelRound = levelRound
        // 新关卡轮次：否决计数与灾痕重置，整局累计的 F 不动
        t.roundVetoes = 0
        t.currentFirstActor = firstActor
        break
      }

      case T11_EVENTS.marksRevealed: {
        const { markIds } = event.payload as { markIds: readonly number[] }
        t.marks = markIds.map((id) => ({ id, holder: null, hasMoved: false }))
        break
      }

      case T11_EVENTS.negotiationRoundStarted: {
        const { negotiationRound, firstActor, actionOrder } = event.payload as {
          negotiationRound: number
          firstActor: SeatId
          actionOrder: readonly SeatId[]
        }
        state.negotiationRound = negotiationRound
        t.currentFirstActor = firstActor
        t.actionOrder = [...actionOrder]
        t.actionCursor = 0
        t.pending = null
        // 承诺、就绪与投票按协商轮重置；灾痕分配保留（docs/12：否决后不清空当前分配）
        t.commitments = []
        t.ready = []
        t.votes = []
        t.lastVerdict = null
        break
      }

      case T11_EVENTS.markAssumed: {
        const { seat, markId } = event.payload as { seat: SeatId; markId: number }
        const mark = t.marks.find((m) => m.id === markId)
        if (mark !== undefined) mark.holder = seat
        t.actionCursor += 1
        break
      }

      case T11_EVENTS.transferRequested: {
        const { requester, holder, markId } = event.payload as {
          requester: SeatId
          holder: SeatId
          markId: number
        }
        t.pending = { requester, holder, markId }
        break
      }

      case T11_EVENTS.transferResponded: {
        // 回应不消耗被申请者的行动；申请无论成败都消耗申请者的行动（docs/12、docs/15 §7.2）
        t.pending = null
        t.actionCursor += 1
        break
      }

      case T11_EVENTS.markTransferred: {
        const { markId, to } = event.payload as { markId: number; to: SeatId }
        const mark = t.marks.find((m) => m.id === markId)
        if (mark !== undefined) {
          mark.holder = to
          mark.hasMoved = true
        }
        break
      }

      case T11_EVENTS.actionPassed:
      case T11_EVENTS.actionTimedOut: {
        t.actionCursor += 1
        break
      }

      case T11_EVENTS.approvalCommitted: {
        const { seat } = event.payload as { seat: SeatId }
        if (!t.commitments.includes(seat)) {
          t.commitments.push(seat)
          t.commitments.sort((a, b) => a - b)
        }
        break
      }

      case T11_EVENTS.exchangeReady: {
        const { seat } = event.payload as { seat: SeatId }
        if (!t.ready.includes(seat)) {
          t.ready.push(seat)
          t.ready.sort((a, b) => a - b)
        }
        break
      }

      case T11_EVENTS.voteLocked: {
        const vote = event.payload as T11Vote
        if (!t.votes.some((v) => v.seat === vote.seat)) {
          t.votes.push({ seat: vote.seat, approve: vote.approve })
          t.votes.sort((a, b) => a.seat - b.seat)
        }
        break
      }

      case T11_EVENTS.proposalPassed: {
        t.lastVerdict = 'passed'
        // 门环三条件在方案通过这一刻判定（docs/12）
        t.hidden.gateConditionsMetThisRound = gateConditionsMet(
          t.marks,
          t.hidden.lamps,
          state.seats.filter((s) => !s.fallen).map((s) => s.id),
          t.votes,
        )
        break
      }

      case T11_EVENTS.proposalVetoed: {
        t.lastVerdict = 'vetoed'
        // 本轮每枚灾痕损失 +1，最终承担奖第一、第二名各 +1（docs/12）
        t.roundVetoes += 1
        t.totalVetoes += 1
        break
      }

      case T11_EVENTS.graceAdvance: {
        // 不记为否决，不提高灾痕损失，也不增加奖池
        t.lastVerdict = 'grace'
        break
      }

      case T11_EVENTS.lossSettled: {
        const { entries } = event.payload as LossSettledPayload
        for (const entry of entries) {
          const seat = mutableSeat(state, entry.seat)
          seat.lifespan -= entry.actualLoss
          if (seat.lifespan < 0) seat.lifespan = 0
          // 承担值等于实际损失，因此「承担值总和 == 实际扣除总和」恒成立（docs/15 §7.3）
          addTally(t.burden, entry.seat, entry.actualLoss)
          addTally(t.settledMarkCount, entry.seat, entry.markIds.length)
          addTally(t.markLossPaid, entry.seat, entry.actualLoss)
        }
        break
      }

      case T11_EVENTS.seatFallen: {
        const { seats } = event.payload as { seats: readonly SeatId[] }
        for (const seat of seats) {
          mutableSeat(state, seat).fallen = true
        }
        break
      }

      case T11_EVENTS.endgameDeclared: {
        const { reason, levelRound } = event.payload as {
          reason: T11EndgameReason
          levelRound: number
        }
        t.endgame = { reason, levelRound }
        break
      }

      case T11_EVENTS.finalBurdenAwarded: {
        const { rankings } = event.payload as {
          rankings: readonly { seat: SeatId; award: number }[]
        }
        for (const { seat, award } of rankings) {
          if (award > 0) mutableSeat(state, seat).lifespan += award
        }
        t.finalAwardPaid = true
        break
      }

      case T11_EVENTS.mandateEvaluated: {
        const { seat, mandateId, achieved, paid } = event.payload as {
          seat: SeatId
          mandateId: string
          achieved: boolean
          paid: number
        }
        if (paid > 0) mutableSeat(state, seat).lifespan += paid
        t.mandateVerdicts.push({ seat, mandateId, achieved, paid })
        t.mandateVerdicts.sort((a, b) => a.seat - b.seat)
        t.mandatesEvaluated = t.mandateVerdicts.length >= t.mandates.length
        break
      }

      case T11_EVENTS.perfectClearSettled: {
        const { refunds } = event.payload as {
          refunds: readonly { seat: SeatId; ticket: number; markLoss: number; bonus: number }[]
        }
        for (const refund of refunds) {
          const seat = mutableSeat(state, refund.seat)
          seat.lifespan += refund.ticket + refund.markLoss + refund.bonus
        }
        break
      }
    }
  }

  isComplete(state: DeepReadonly<KernelState<T11State>>): boolean {
    return state.phase === T11_PHASES.done
  }

  settlement(): SettlementDeclaration {
    return {
      ticketPerSeat: this.#params.ticketPerSeat,
      recoveryEventTypes: [T11_EVENTS.lossSettled],
      awardEventTypes: [
        T11_EVENTS.finalBurdenAwarded,
        T11_EVENTS.mandateEvaluated,
        T11_EVENTS.perfectClearSettled,
      ],
      deathEventType: T11_EVENTS.seatFallen,
      deathEquivalent: 10,
    }
  }

  predicateBindings(): PredicateBindings {
    return buildPredicateBindings()
  }

  /** 锚点注册表存在但为空，可用性判定恒为假（docs/15 §5 MVP 第 1 条）。 */
  anchorBindings(): AnchorBindings {
    return {}
  }

  /** docs/14「T-11 的创伤供给」。③ 创伤绑定是必需的，缺失则本关不产生渴望。 */
  traumaBindings(): TraumaBindings {
    return [
      {
        eventType: T11_EVENTS.proposalVetoed,
        feeds: ['W1', 'W4'],
        note: '承诺认可后投反对、公开承诺后食言',
      },
      { eventType: T11_EVENTS.finalBurdenAwarded, feeds: ['W8'], note: '承担最多却未获奖' },
      { eventType: T11_EVENTS.transferResponded, feeds: ['W5'], note: '转移申请被拒、无人愿意与我交换' },
      { eventType: T11_EVENTS.markTransferred, feeds: ['W3'], note: '被迫承担、被强制转来灾痕' },
      { eventType: T11_EVENTS.seatFallen, feeds: ['W2', 'W7'], note: '灾痕结算逼近归零' },
      {
        eventType: T11_EVENTS.lossSettled,
        feeds: ['W6'],
        // docs/14 ⚠：W6 不得绑定致人死亡，口径须为「他人因我而实际损失余命」
        note: '他人因我的行动实际损失余命；不绑定致人死亡',
      },
    ]
  }
}

// ─────────────────────────── 模块级纯函数 ───────────────────────────

function phaseEntered(phase: string): EventDraft {
  return ruleEvent(T11_EVENTS.phaseEntered, { phase }, PUBLIC)
}

function endgameReason(
  state: DeepReadonly<KernelState<T11State>>,
  params: T11Params,
): 'allRoundsAllAlive' | 'allRoundsWithFallen' | 'earlyEnd' {
  if (state.levelRound >= params.levelRounds) {
    return state.seats.some((s) => s.fallen) ? 'allRoundsWithFallen' : 'allRoundsAllAlive'
  }
  return 'earlyEnd'
}

/**
 * 最终承担奖排名（docs/12「最终承担奖」）。
 * 同分时依次比较：结算灾痕总枚数更多者、入场时余命更低者、座次更靠前者。
 * 失守者不能获奖，名次顺延。
 */
function finalBurdenRankings(
  state: DeepReadonly<KernelState<T11State>>,
): readonly { seat: SeatId; burden: number; rank: number; award: number }[] {
  const t = state.template
  const eligible = state.seats.filter((s) => !s.fallen).map((s) => s.id)

  const ranked = [...eligible].sort((a, b) => {
    const burdenDiff = tallyOf(t.burden, b) - tallyOf(t.burden, a)
    if (burdenDiff !== 0) return burdenDiff
    const marksDiff = tallyOf(t.settledMarkCount, b) - tallyOf(t.settledMarkCount, a)
    if (marksDiff !== 0) return marksDiff
    const lifespanDiff = tallyOf(t.entryLifespan, a) - tallyOf(t.entryLifespan, b)
    if (lifespanDiff !== 0) return lifespanDiff
    return a - b
  })

  const awards = [
    t.params.finalAwardFirst + t.totalVetoes,
    t.params.finalAwardSecond + t.totalVetoes,
  ]

  return ranked.map((seat, index) => ({
    seat,
    burden: tallyOf(t.burden, seat),
    rank: index + 1,
    award: awards[index] ?? 0,
  }))
}
