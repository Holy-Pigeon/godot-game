/**
 * 用机器人跑完整一局，并从事件流复算经济指标。
 *
 * docs/15 §10：批量模拟是这个项目性价比最高的一项投入——
 * docs/12 的全部数值都只是纸面推算，有了确定性内核和机器人，一晚上就能跑出来。
 */

import { Runtime, command, type EventRecord, type SeatSetup } from '@terminus/kernel'
import {
  T11Template,
  T11_COMMANDS,
  T11_EVENTS,
  T11_DEFAULT_PARAMS,
  type LossSettledPayload,
  type T11EndgameReason,
  type T11Params,
  type T11State,
} from '@terminus/templates'
import { DEFAULT_BOT_PROFILE, T11Bot, type BotProfile } from './bot.ts'

export interface MatchOptions {
  readonly seed: number
  readonly seatCount: number
  /** 每人入场余命（支付门票前）。调低它才能压出「剩两人提前结束」路径（docs/15 §10）。 */
  readonly lifespan: number
  readonly params?: T11Params
  readonly profile?: BotProfile
}

export interface MandateOutcome {
  readonly mandateId: string
  readonly achieved: boolean
  readonly paid: number
}

export interface MatchResult {
  readonly seed: number
  readonly endgameReason: T11EndgameReason
  readonly levelRoundsPlayed: number
  /** 整局累计否决次数 F。 */
  readonly totalVetoes: number
  readonly graceAdvances: number
  /** 共同决策轮数 K。仅服务端可见的内部量，模拟器读得到是因为它跑在权威端。 */
  readonly coDecisionRounds: number
  readonly gateRingTurns: number
  readonly perfectClear: boolean | null
  readonly fallenCount: number
  /** docs/02：固定门票 + 规则回收余命 + 规则致死数 × 10。 */
  readonly recoveryTier: number
  /** docs/02：固定门票 + 规则回收余命 − 系统实际发放的余命。 */
  readonly netRecovery: number
  readonly ticketTotal: number
  readonly markLossTotal: number
  readonly awardTotal: number
  readonly mandates: readonly MandateOutcome[]
  readonly lastSeq: number
  readonly stateHash: string
  readonly ruleEvents: readonly EventRecord[]
}

const MAX_COMMANDS_PER_MATCH = 20_000

/**
 * 跑完一局。
 *
 * 每一轮：先让每个机器人有机会出手，若整轮无人出手且对局仍未结束，
 * 就注入一次会话层超时——这正是真人局里所有人挂机时会发生的事，
 * 因此模拟器不需要另一套推进逻辑。
 */
export function runMatch(options: MatchOptions): MatchResult {
  const params = options.params ?? T11_DEFAULT_PARAMS
  const template = new T11Template(params)
  const seats: readonly SeatSetup[] = Array.from({ length: options.seatCount }, (_, i) => ({
    id: i + 1,
    lifespan: options.lifespan,
  }))

  const runtime = new Runtime<T11State>(template as never, { seed: options.seed, seats })
  const bots = seats.map((s) => new T11Bot(s.id, options.seed, options.profile ?? DEFAULT_BOT_PROFILE))

  runtime.open()

  let issued = 0
  while (!runtime.isComplete) {
    let acted = false
    for (const bot of bots) {
      if (runtime.isComplete) break
      const next = bot.decide(runtime.state)
      if (next === null) continue
      const result = runtime.submit(next)
      if (result.ok) acted = true
      if (++issued > MAX_COMMANDS_PER_MATCH) {
        throw new Error(`第 ${options.seed} 局未在 ${MAX_COMMANDS_PER_MATCH} 条命令内结束`)
      }
    }
    if (runtime.isComplete) break
    if (!acted) {
      // 全员无动作：交给会话层超时推进（docs/15 §2.4 第 4 条）
      const result = runtime.submit(command(T11_COMMANDS.timeout, null, {}))
      if (!result.ok) {
        throw new Error(`对局卡死在阶段 ${runtime.state.phase}：${result.reason}`)
      }
    }
  }

  return summarize(runtime, options.seed, params)
}

function summarize(
  runtime: Runtime<T11State>,
  seed: number,
  params: T11Params,
): MatchResult {
  const facts = runtime.facts
  const state = runtime.state
  const t = state.template

  const ticketTotal = sumPayload<{ entries: readonly { amount: number }[] }>(
    facts.ofType(T11_EVENTS.ticketCharged),
    (p) => p.entries.reduce((acc, e) => acc + e.amount, 0),
  )

  const markLossTotal = sumPayload<LossSettledPayload>(
    facts.ofType(T11_EVENTS.lossSettled),
    (p) => p.entries.reduce((acc, e) => acc + e.actualLoss, 0),
  )

  const burdenAward = sumPayload<{ rankings: readonly { award: number }[] }>(
    facts.ofType(T11_EVENTS.finalBurdenAwarded),
    (p) => p.rankings.reduce((acc, r) => acc + r.award, 0),
  )
  const mandateAward = sumPayload<{ paid: number }>(
    facts.ofType(T11_EVENTS.mandateEvaluated),
    (p) => p.paid,
  )
  const perfectRefund = sumPayload<{
    refunds: readonly { ticket: number; markLoss: number; bonus: number }[]
  }>(facts.ofType(T11_EVENTS.perfectClearSettled), (p) =>
    p.refunds.reduce((acc, r) => acc + r.ticket + r.markLoss + r.bonus, 0),
  )

  const fallenCount = state.seats.filter((s) => s.fallen).length
  const awardTotal = burdenAward + mandateAward + perfectRefund
  const rolled = facts.lastOfType<{ success: boolean }>(T11_EVENTS.perfectClearRolled)

  return {
    seed,
    endgameReason: t.endgame?.reason ?? 'earlyEnd',
    levelRoundsPlayed: state.levelRound,
    totalVetoes: t.totalVetoes,
    graceAdvances: facts.countOfType(T11_EVENTS.graceAdvance),
    coDecisionRounds: t.hidden.coDecisionRounds,
    gateRingTurns: t.hidden.gateRingTurns,
    perfectClear: rolled?.payload.success ?? null,
    fallenCount,
    // docs/02：死亡的 10 余命只用于回收等级换算，不进入系统净回收
    recoveryTier: ticketTotal + markLossTotal + fallenCount * 10,
    netRecovery: ticketTotal + markLossTotal - awardTotal,
    ticketTotal,
    markLossTotal,
    awardTotal,
    mandates: facts
      .ofType<{ mandateId: string; achieved: boolean; paid: number }>(T11_EVENTS.mandateEvaluated)
      .map((e) => ({
        mandateId: e.payload.mandateId,
        achieved: e.payload.achieved,
        paid: e.payload.paid,
      })),
    lastSeq: runtime.log.lastSeq,
    stateHash: runtime.snapshot(`t11@${params.levelRounds}r`).stateHash,
    ruleEvents: runtime.log.ruleEvents,
  }
}

function sumPayload<P>(
  events: readonly EventRecord<P>[],
  extract: (payload: P) => number,
): number {
  return events.reduce((acc, e) => acc + extract(e.payload), 0)
}
