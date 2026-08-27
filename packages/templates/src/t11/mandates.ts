/**
 * 密令池与判定（docs/12「密令池与奖励」、docs/15 §7.6）。
 *
 * 密令表是数据（标识 / 难度 / 目标 / 配合标记 / 判定名），判定原语在本文件。
 * 复用已有原语的新密令 = 纯数据，只有真正的新条件才需要新增原语。
 *
 * 三条结构要求：
 *   - 抽取结果先写成事件；密令只对本人可见。
 *   - 局末一次性求值，只读规则事件流；每条成功判定必须引用具体事件序号。
 *   - 记录与发放分开：失守者不获奖，但判定结果仍然入档，只是发放额归零。
 */

import type { DeepReadonly, FactProjection, KernelState, SeatId, TraumaId } from '@terminus/kernel'
import { T11_EVENTS, type T11State } from './types.ts'

export type MandateDifficulty = 'low' | 'mid' | 'high'

/** 结算事件的载荷。判定几乎全部依赖它，因此结构在这里固定下来。 */
export interface LossSettledPayload {
  readonly levelRound: number
  readonly lossPerMark: number
  /** 只含实际持有灾痕的座位。持有 0 枚者不出现在表里。 */
  readonly entries: readonly {
    readonly seat: SeatId
    readonly markIds: readonly number[]
    /** 名义损失：持有枚数 × 单枚损失。 */
    readonly nominalLoss: number
    /** 实际扣除值，归零截断后的（docs/15 §6）。承担值等于它。 */
    readonly actualLoss: number
  }[]
}

export interface VotesRevealedPayload {
  readonly votes: readonly { readonly seat: SeatId; readonly approve: boolean }[]
}

export interface TransferRespondedPayload {
  readonly requester: SeatId
  readonly holder: SeatId
  readonly markId: number
  readonly accepted: boolean
}

export interface MandateContext {
  readonly facts: FactProjection
  readonly state: DeepReadonly<KernelState<T11State>>
  readonly seat: SeatId
  readonly target: SeatId | null
}

export interface MandateVerdict {
  readonly achieved: boolean
  /** 证据强制引用：无引用的成功判定一律作废（docs/13）。 */
  readonly evidenceSeqs: readonly number[]
}

const failed: MandateVerdict = { achieved: false, evidenceSeqs: [] }
const met = (seqs: readonly number[]): MandateVerdict => ({ achieved: true, evidenceSeqs: seqs })

export interface MandateDefinition {
  readonly id: string
  /** 玩家可见的标题，如【守住】。 */
  readonly title: string
  readonly difficulty: MandateDifficulty
  /** 玩家可见的目标描述。 */
  readonly goal: string
  /** 客观达成条件，与 docs/12 表格逐字对应。 */
  readonly condition: string
  /** 指向另一名玩家的密令（带 X）。 */
  readonly needsTarget: boolean
  /**
   * 依赖他人配合。docs/15 §7.6：发令器必须标记它，
   * 并在批量模拟中按密令标识分别统计完成率——依赖他人的密令若系统性失败，会藏在平均值里。
   */
  readonly dependsOnOthers: boolean
  /**
   * 密令类别 → 创伤映射。docs/14 遗留未决项，MVP 预留字段留空（docs/15 §6、§12）。
   */
  readonly trauma: TraumaId | null
  readonly judge: (ctx: MandateContext) => MandateVerdict
}

// ─────────────────────────── 判定原语 ───────────────────────────

function settlements(facts: FactProjection) {
  return facts.ofType<LossSettledPayload>(T11_EVENTS.lossSettled)
}

/** 某座位在一次结算中结算的灾痕枚数。 */
function marksSettledIn(payload: LossSettledPayload, seat: SeatId): number {
  return payload.entries.find((e) => e.seat === seat)?.markIds.length ?? 0
}

function totalMarksSettled(facts: FactProjection, seat: SeatId): { count: number; seqs: number[] } {
  const seqs: number[] = []
  let count = 0
  for (const event of settlements(facts)) {
    const n = marksSettledIn(event.payload, seat)
    if (n > 0) {
      count += n
      seqs.push(event.seq)
    }
  }
  return { count, seqs }
}

function isAlive(ctx: MandateContext, seat: SeatId): boolean {
  return ctx.state.seats.find((s) => s.id === seat)?.fallen === false
}

function endgameSeq(facts: FactProjection): number | undefined {
  return facts.lastOfType(T11_EVENTS.endgameDeclared)?.seq
}

// ─────────────────────────── 密令表（docs/12） ───────────────────────────

export const T11_MANDATES: readonly MandateDefinition[] = [
  {
    id: 'M-01',
    title: '【守住】',
    difficulty: 'low',
    goal: 'X 活到关卡结束',
    condition: '结束时 X 仍在场',
    needsTarget: true,
    dependsOnOthers: true,
    trauma: null,
    judge: (ctx) => {
      if (ctx.target === null) return failed
      const seq = endgameSeq(ctx.facts)
      if (seq === undefined) return failed
      return isAlive(ctx, ctx.target) ? met([seq]) : failed
    },
  },
  {
    id: 'M-02',
    title: '【一起扛】',
    difficulty: 'low',
    goal: '与 X 一起承担',
    condition: '至少一轮中我与 X 都结算了灾痕',
    needsTarget: true,
    dependsOnOthers: true,
    trauma: null,
    judge: (ctx) => {
      if (ctx.target === null) return failed
      for (const event of settlements(ctx.facts)) {
        if (
          marksSettledIn(event.payload, ctx.seat) > 0 &&
          marksSettledIn(event.payload, ctx.target) > 0
        ) {
          return met([event.seq])
        }
      }
      return failed
    },
  },
  {
    id: 'M-03',
    title: '【松手】',
    difficulty: 'low',
    goal: '让 X 交出灾痕',
    condition: 'X 至少一次同意别人从他手中接走灾痕',
    needsTarget: true,
    dependsOnOthers: true,
    trauma: null,
    judge: (ctx) => {
      if (ctx.target === null) return failed
      const hit = ctx.facts
        .ofType<TransferRespondedPayload>(T11_EVENTS.transferResponded)
        .find((e) => e.payload.holder === ctx.target && e.payload.accepted)
      return hit === undefined ? failed : met([hit.seq])
    },
  },
  {
    id: 'M-04',
    title: '【别碰他】',
    difficulty: 'low',
    goal: '限制 X 的灾痕',
    condition: 'X 整局累计结算不超过 3 枚灾痕',
    needsTarget: true,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      if (ctx.target === null) return failed
      const end = endgameSeq(ctx.facts)
      if (end === undefined) return failed
      const { count, seqs } = totalMarksSettled(ctx.facts, ctx.target)
      // 一枚都没结算也算达成，此时用终局事件作为证据
      return count <= 3 ? met(seqs.length > 0 ? seqs : [end]) : failed
    },
  },
  {
    id: 'M-05',
    title: '【都给我】',
    difficulty: 'mid',
    goal: '集中承担',
    condition: '至少一轮中我结算 2 枚灾痕并存活',
    needsTarget: false,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      for (const event of settlements(ctx.facts)) {
        const entry = event.payload.entries.find((e) => e.seat === ctx.seat)
        if (entry === undefined || entry.markIds.length < 2) continue
        // 「并存活」：只看这一次结算有没有把自己扣到失守，后续轮次死掉不影响本条已达成
        const fellHere = ctx.facts
          .ofType<{ seats: readonly SeatId[] }>(T11_EVENTS.seatFallen, {
            levelRound: event.levelRound,
            negotiationRound: event.negotiationRound,
          })
          .some((f) => f.payload.seats.includes(ctx.seat))
        if (!fellHere) return met([event.seq])
      }
      return failed
    },
  },
  {
    id: 'M-06',
    title: '【拿回来】',
    difficulty: 'mid',
    goal: '主动接手 X 的灾痕',
    condition: 'X 同意我的转移申请，且该灾痕最终由我结算',
    needsTarget: true,
    dependsOnOthers: true,
    trauma: null,
    judge: (ctx) => {
      if (ctx.target === null) return failed
      const accepted = ctx.facts
        .ofType<TransferRespondedPayload>(T11_EVENTS.transferResponded)
        .filter((e) => e.payload.holder === ctx.target && e.payload.requester === ctx.seat && e.payload.accepted)
      for (const transfer of accepted) {
        const settled = settlements(ctx.facts).find(
          (s) =>
            s.seq > transfer.seq &&
            (s.payload.entries.find((e) => e.seat === ctx.seat)?.markIds ?? []).includes(
              transfer.payload.markId,
            ),
        )
        if (settled !== undefined) return met([transfer.seq, settled.seq])
      }
      return failed
    },
  },
  {
    id: 'M-07',
    title: '【说话不算】',
    difficulty: 'mid',
    goal: '承诺后反对',
    condition: '我在某协商轮公开承诺认可、最终投反对，且该协商轮被否决',
    needsTarget: false,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      const commitments = ctx.facts.ofType<{ seat: SeatId }>(T11_EVENTS.approvalCommitted)
        .filter((e) => e.payload.seat === ctx.seat)
      for (const commitment of commitments) {
        const window = {
          levelRound: commitment.levelRound,
          negotiationRound: commitment.negotiationRound,
        }
        const revealed = ctx.facts.lastOfType<VotesRevealedPayload>(T11_EVENTS.votesRevealed, window)
        const vetoed = ctx.facts.lastOfType(T11_EVENTS.proposalVetoed, window)
        if (revealed === undefined || vetoed === undefined) continue
        const mine = revealed.payload.votes.find((v) => v.seat === ctx.seat)
        if (mine?.approve === false) return met([commitment.seq, revealed.seq, vetoed.seq])
      }
      return failed
    },
  },
  {
    id: 'M-08',
    title: '【一份不留】',
    difficulty: 'mid',
    goal: '从有到无',
    condition: '我曾持有灾痕，最终通过转移在结算时持有 0 枚',
    needsTarget: false,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      const everHeld = ctx.facts
        .ofType<{ seat: SeatId }>(T11_EVENTS.markAssumed)
        .filter((e) => e.payload.seat === ctx.seat)
      const gaveAway = ctx.facts
        .ofType<{ from: SeatId | null; to: SeatId }>(T11_EVENTS.markTransferred)
        .filter((e) => e.payload.from === ctx.seat)
      if (everHeld.length === 0 || gaveAway.length === 0) return failed

      const all = settlements(ctx.facts)
      const last = all[all.length - 1]
      if (last === undefined) return failed
      if (marksSettledIn(last.payload, ctx.seat) > 0) return failed
      const firstHeld = everHeld[0]
      const lastGave = gaveAway[gaveAway.length - 1]
      if (firstHeld === undefined || lastGave === undefined) return failed
      return met([firstHeld.seq, lastGave.seq, last.seq])
    },
  },
  {
    id: 'M-09',
    title: '【四人共担】',
    difficulty: 'high',
    goal: '四枚分给四人',
    condition: '一次通过的方案中恰有 4 名玩家各结算 1 枚',
    needsTarget: false,
    dependsOnOthers: true,
    trauma: null,
    judge: (ctx) => {
      for (const event of settlements(ctx.facts)) {
        const holders = event.payload.entries.filter((e) => e.markIds.length > 0)
        if (holders.length === 4 && holders.every((e) => e.markIds.length === 1)) {
          return met([event.seq])
        }
      }
      return failed
    },
  },
  {
    id: 'M-10',
    title: '【活得最少】',
    difficulty: 'high',
    goal: '低余命存活',
    condition: '活到结束且余命处于存活者后 1/3',
    needsTarget: false,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      // docs/15 §7.5：读的是发奖后的余命，因此本条只能在最终承担奖发放之后求值。
      const award = ctx.facts.lastOfType(T11_EVENTS.finalBurdenAwarded)
      if (award === undefined) return failed
      if (!isAlive(ctx, ctx.seat)) return failed

      const living = ctx.state.seats.filter((s) => !s.fallen)
      const sorted = [...living].sort((a, b) => a.lifespan - b.lifespan || a.id - b.id)
      // 后 1/3 取 ceil(n/3) 名；余命并列时一并计入，不按座次切断
      const cutoffIndex = Math.ceil(sorted.length / 3) - 1
      const cutoff = sorted[cutoffIndex]
      if (cutoff === undefined) return failed
      const mine = ctx.state.seats.find((s) => s.id === ctx.seat)
      if (mine === undefined) return failed
      return mine.lifespan <= cutoff.lifespan ? met([award.seq]) : failed
    },
  },
  {
    id: 'M-11',
    title: '【独自逆流】',
    difficulty: 'high',
    goal: '唯一的反对票',
    condition: '某个通过的方案中，我是全场唯一投反对票的人',
    needsTarget: false,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      for (const passed of ctx.facts.ofType(T11_EVENTS.proposalPassed)) {
        const revealed = ctx.facts.lastOfType<VotesRevealedPayload>(T11_EVENTS.votesRevealed, {
          levelRound: passed.levelRound,
          negotiationRound: passed.negotiationRound,
        })
        if (revealed === undefined) continue
        const dissenters = revealed.payload.votes.filter((v) => !v.approve).map((v) => v.seat)
        if (dissenters.length === 1 && dissenters[0] === ctx.seat) {
          return met([revealed.seq, passed.seq])
        }
      }
      return failed
    },
  },
  {
    id: 'M-12',
    title: '【一次都不】',
    difficulty: 'high',
    goal: '全程不结算',
    condition: '活到关卡结束，且每次通过的结算中我持有 0 枚灾痕',
    needsTarget: false,
    dependsOnOthers: false,
    trauma: null,
    judge: (ctx) => {
      const end = endgameSeq(ctx.facts)
      if (end === undefined) return failed
      if (!isAlive(ctx, ctx.seat)) return failed
      const all = settlements(ctx.facts)
      if (all.some((e) => marksSettledIn(e.payload, ctx.seat) > 0)) return failed
      return met([end, ...all.map((e) => e.seq)])
    },
  },
]

export const MANDATE_BY_ID: ReadonlyMap<string, MandateDefinition> = new Map(
  T11_MANDATES.map((m) => [m.id, m]),
)

export function mandateAwardOf(
  definition: MandateDefinition,
  award: { readonly low: number; readonly mid: number; readonly high: number },
): number {
  return award[definition.difficulty]
}
