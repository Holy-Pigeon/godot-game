/**
 * T-11「最后提案」的状态、阶段、事件与命令。
 *
 * 规则真源是 docs/12，结构安排真源是 docs/15 §7。本文件只写这些规则在结构上怎么摆。
 */

import type { SeatId } from '@terminus/kernel'

// ─────────────────────────── 参数（docs/12「入场公示与参数」） ───────────────────────────

export interface T11Params {
  /** 关卡轮次总数。 */
  readonly levelRounds: number
  /** 每个关卡轮次放出的灾痕数。 */
  readonly marksPerRound: number
  /** 每人最多持有的灾痕数。 */
  readonly maxMarksPerSeat: number
  /** 固定门票，整数日。 */
  readonly ticketPerSeat: number
  /** 最终承担奖第一名基础值。每次否决 +1。 */
  readonly finalAwardFirst: number
  /** 最终承担奖第二名基础值。每次否决 +1。 */
  readonly finalAwardSecond: number
  /** 密令奖：低 / 中 / 高。 */
  readonly mandateAward: { readonly low: number; readonly mid: number; readonly high: number }
  /** 自由交流时长。超时由会话层以事件注入内核（docs/15 §2.4 第 4 条）。 */
  readonly freeExchangeMs: number
  /** 认可投票时长。 */
  readonly approvalVoteMs: number
  /** 顺序行动每人时长。 */
  readonly sequentialActionMs: number
  /** 剩余存活人数降到该值时关卡提前结束。 */
  readonly earlyEndAtSeats: number
  /** 完美通关时每名存活玩家额外获得的余命。 */
  readonly perfectClearBonus: number
}

export const T11_DEFAULT_PARAMS: T11Params = {
  levelRounds: 6,
  marksPerRound: 4,
  maxMarksPerSeat: 2,
  ticketPerSeat: 2,
  finalAwardFirst: 14,
  finalAwardSecond: 8,
  mandateAward: { low: 1, mid: 2, high: 3 },
  freeExchangeMs: 60_000,
  approvalVoteMs: 45_000,
  sequentialActionMs: 30_000,
  earlyEndAtSeats: 2,
  perfectClearBonus: 1,
}

/**
 * 幕次与单枚基础损失。
 *
 * docs/15 §7.3：可推导的量不进状态。幕次由轮次推出，当前损失由幕次与本轮否决数推出——
 * 独立存储会在重放时两处不同步。
 */
export function actOfRound(levelRound: number): number {
  return Math.ceil(levelRound / 2)
}

/** 三幕单枚基础损失依次为 1 / 2 / 3 日（docs/12）。 */
export function baseLossOfRound(levelRound: number): number {
  return actOfRound(levelRound)
}

/** 当前单枚损失：基础损失 + 本关卡轮次已发生的否决数。 */
export function lossPerMark(levelRound: number, roundVetoes: number): number {
  return baseLossOfRound(levelRound) + roundVetoes
}

// ─────────────────────────── 阶段（docs/15 §7.1） ───────────────────────────

/**
 * 九个阶段落成一张数据表，而不是一串分支。
 *
 * 两个回响窗口阶段现在就必须存在，即使 MVP 零耗时穿过——回响接入时只是给它们
 * 挂上处理器，不动状态机拓扑。这是最廉价的一次预留。
 */
export const T11_PHASES = {
  disasterReveal: 't11.disasterReveal',
  sequentialAction: 't11.sequentialAction',
  allocationCheck: 't11.allocationCheck',
  echoWindowAllocation: 't11.echoWindowAllocation',
  freeExchange: 't11.freeExchange',
  approvalVote: 't11.approvalVote',
  echoWindowInformation: 't11.echoWindowInformation',
  voteReveal: 't11.voteReveal',
  settlementOrVeto: 't11.settlementOrVeto',
  finalSettlement: 't11.finalSettlement',
  done: 't11.done',
} as const

export type T11Phase = (typeof T11_PHASES)[keyof typeof T11_PHASES]

// ─────────────────────────── 命令 ───────────────────────────

export const T11_COMMANDS = {
  /** 领取 1 枚尚未有人承担的灾痕。 */
  assumeMark: 't11.assumeMark',
  /** 申请把别人持有的 1 枚灾痕转给自己。 */
  requestTransfer: 't11.requestTransfer',
  /** 被申请者同意或拒绝。不消耗其本协商轮行动。 */
  respondTransfer: 't11.respondTransfer',
  /** 不选，结束自己的行动。 */
  pass: 't11.pass',
  /** 自由交流阶段唯一的结构化动作：公开表态本轮将投认可票。 */
  commitApproval: 't11.commitApproval',
  /** 自由交流就绪。 */
  ready: 't11.ready',
  /** 锁定认可 / 反对票。 */
  lockVote: 't11.lockVote',
  /** 公开发言，进行为语料流。 */
  speak: 't11.speak',
  /** 私聊，进行为语料流。 */
  whisper: 't11.whisper',
  /** 会话层注入的阶段超时（docs/15 §2.4 第 4 条：内核不读系统时间）。 */
  timeout: 't11.timeout',
} as const

// ─────────────────────────── 事件 ───────────────────────────

export const T11_EVENTS = {
  matchStarted: 't11.matchStarted',
  ticketCharged: 't11.ticketCharged',
  mandateDealt: 't11.mandateDealt',
  phaseEntered: 't11.phaseEntered',
  levelRoundStarted: 't11.levelRoundStarted',
  marksRevealed: 't11.marksRevealed',
  negotiationRoundStarted: 't11.negotiationRoundStarted',
  markAssumed: 't11.markAssumed',
  transferRequested: 't11.transferRequested',
  transferResponded: 't11.transferResponded',
  markTransferred: 't11.markTransferred',
  actionPassed: 't11.actionPassed',
  actionTimedOut: 't11.actionTimedOut',
  allocationChecked: 't11.allocationChecked',
  approvalCommitted: 't11.approvalCommitted',
  exchangeReady: 't11.exchangeReady',
  voteLocked: 't11.voteLocked',
  votesRevealed: 't11.votesRevealed',
  proposalPassed: 't11.proposalPassed',
  proposalVetoed: 't11.proposalVetoed',
  /** 第一协商轮仅因未分完而无代价进入第二协商轮：不记否决、不升级。 */
  graceAdvance: 't11.graceAdvance',
  lossSettled: 't11.lossSettled',
  seatFallen: 't11.seatFallen',
  levelRoundEnded: 't11.levelRoundEnded',
  endgameDeclared: 't11.endgameDeclared',
  /** 仅服务端：含共同决策轮数的终局留档（docs/15 §7.5、§8）。 */
  endgameRecorded: 't11.endgameRecorded',
  finalBurdenAwarded: 't11.finalBurdenAwarded',
  mandateEvaluated: 't11.mandateEvaluated',
  perfectClearRolled: 't11.perfectClearRolled',
  perfectClearSettled: 't11.perfectClearSettled',
  // 潜规则层的世界内反馈：公开，但不附带任何解释文字（docs/15 §8）
  participationLampLit: 't11.participationLampLit',
  markCrackClosed: 't11.markCrackClosed',
  ringPulse: 't11.ringPulse',
  gateRingTurned: 't11.gateRingTurned',
  /** 仅服务端：共同决策轮计数（docs/15 §8 潜规则内部量永不下发）。 */
  coDecisionRoundCounted: 't11.coDecisionRoundCounted',
  // 行为语料流
  publicSpeech: 't11.publicSpeech',
  privateMessage: 't11.privateMessage',
} as const

// ─────────────────────────── 状态 ───────────────────────────

/**
 * 持有者变更的来源。
 *
 * docs/15 §5 第 3 条：所有持有者变更事件带来源字段，MVP 恒为 voluntary。
 * 这条不是可选的——潜规则明确规定回响强制移动不点亮自愿参与灯，
 * 这条差异是玩家推理链的关键。
 */
export type HolderChangeSource = 'voluntary' | 'echoForced'

export interface T11Mark {
  readonly id: number
  holder: SeatId | null
  /** 是否发生过玩家间移动。普通自愿转移与回响强制移动都计入（docs/12 共同决策轮条件 2）。 */
  hasMoved: boolean
}

/** 顺序行动阶段内部的待回应子状态，不是新阶段（docs/15 §7.2）。 */
export interface T11PendingTransfer {
  readonly requester: SeatId
  readonly holder: SeatId
  readonly markId: number
}

/**
 * 投票揭晓后的三种去向。
 *
 * grace 是 docs/12 的特例：第一协商轮仅因未分完、且反对票不超过 1 张时，
 * 保留分配直接进入第二协商轮——不记为否决，不提高损失，也不增加奖池。
 */
export type T11Verdict = 'passed' | 'vetoed' | 'grace'

export interface T11Vote {
  readonly seat: SeatId
  readonly approve: boolean
}

export interface T11SeatTally {
  readonly seat: SeatId
  value: number
}

export type T11EndgameReason =
  /** 打完全部轮次且全员存活——唯一执行完美判定的路径。 */
  | 'allRoundsAllAlive'
  /** 打完全部轮次但有人失守。docs/15 §7.5：这是最常见的一条。 */
  | 'allRoundsWithFallen'
  /** 剩两人提前结束。 */
  | 'earlyEnd'

export interface T11Endgame {
  readonly reason: T11EndgameReason
  /** 宣告时的关卡轮次。 */
  readonly levelRound: number
}

/**
 * 潜规则层状态（docs/12「内部潜规则」）。
 *
 * 独立于主流程：只由 hidden.ts 的归约写入，主流程只读 coDecisionRounds 做完美判定。
 * 内部量一律仅服务端，永不下发（docs/15 §8）——客户端不能拿到共同决策轮的计数值，
 * 否则可以直接读出潜规则。
 */
export interface T11HiddenState {
  /** 本关卡轮次已点亮参与灯的座位，升序。 */
  lamps: SeatId[]
  /** 整局共同决策轮数 K。完美判定的唯一输入。 */
  coDecisionRounds: number
  /** 门环转动次数。一经转动不会复位。 */
  gateRingTurns: number
  /** 本关卡轮次是否已出现过环形脉冲。 */
  ringPulsedThisRound: boolean
  /** 本关卡轮次已闭合过裂纹的灾痕 id，升序。裂纹只在首次移动时闭合。 */
  cracksClosedThisRound: number[]
  /** 本关卡轮次是否有人因灾痕结算而失守（共同决策轮条件 4）。 */
  fallenThisRound: boolean
  /** 本关卡轮次门环三条件是否已满足（投票揭晓时判定）。 */
  gateConditionsMetThisRound: boolean
}

export interface T11MandateAssignment {
  readonly seat: SeatId
  readonly mandateId: string
  /** 指向另一名玩家的密令（带 X）才有目标。 */
  readonly target: SeatId | null
}

export interface T11MandateVerdict {
  readonly seat: SeatId
  readonly mandateId: string
  readonly achieved: boolean
  /** 实际发放额。失守者判定入档但发放归零（docs/15 §7.6）。 */
  readonly paid: number
}

export interface T11State {
  readonly params: T11Params
  /** 本关卡轮次的灾痕。轮次结束后重建。 */
  marks: T11Mark[]
  /** 本协商轮的行动顺序，按首位行动者起算的存活座位。 */
  actionOrder: SeatId[]
  /** 行动游标：actionOrder 的下标。等于长度表示本协商轮行动完毕。 */
  actionCursor: number
  pending: T11PendingTransfer | null
  /** 本协商轮公开承诺认可的座位，升序。每人每协商轮最多一次，不可撤回。 */
  commitments: SeatId[]
  /** 本协商轮自由交流已就绪的座位，升序。 */
  ready: SeatId[]
  /** 本协商轮已锁定的投票，按座位升序。锁定前仅本人可见。 */
  votes: T11Vote[]
  /** 本协商轮的投票判定结果。settlementOrVeto 阶段据此执行。 */
  lastVerdict: T11Verdict | null
  /** 本协商轮的首位行动者。否决后顺延一个仍存活座位。 */
  currentFirstActor: SeatId | null
  /** 本关卡轮次已发生的否决数——决定本轮单枚损失。 */
  roundVetoes: number
  /** 整局累计否决数 F——决定最终承担奖 14+F / 8+F。 */
  totalVetoes: number
  /** 整局累计承担值，按座位升序。只用于最终排名，不是货币。 */
  burden: T11SeatTally[]
  /** 整局累计结算灾痕枚数。最终承担奖同分时的第一比较项。 */
  settledMarkCount: T11SeatTally[]
  /** 入场余命。最终承担奖同分时的第二比较项。 */
  entryLifespan: T11SeatTally[]
  /** 每人一条密令，仅本人可见。 */
  mandates: T11MandateAssignment[]
  endgame: T11Endgame | null
  /** 终局必须拆两步，中间隔一次提交（docs/15 §7.5）。 */
  finalAwardPaid: boolean
  mandatesEvaluated: boolean
  /** 密令判定结果，按座位升序。求值完成的判据是它的长度等于密令数。 */
  mandateVerdicts: T11MandateVerdict[]
  /** 本局灾痕实际扣除总额，按座位升序。完美通关退款要用。 */
  markLossPaid: T11SeatTally[]
  /** 本局实际支付的门票总额，按座位升序。完美通关退款要用。 */
  ticketPaid: T11SeatTally[]
  hidden: T11HiddenState
}

// ─────────────────────────── 状态读取辅助 ───────────────────────────

export function tallyOf(tallies: readonly T11SeatTally[], seat: SeatId): number {
  return tallies.find((t) => t.seat === seat)?.value ?? 0
}

export function addTally(tallies: T11SeatTally[], seat: SeatId, amount: number): void {
  const found = tallies.find((t) => t.seat === seat)
  if (found === undefined) {
    tallies.push({ seat, value: amount })
    tallies.sort((a, b) => a.seat - b.seat)
  } else {
    found.value += amount
  }
}

export function marksHeldBy(marks: readonly T11Mark[], seat: SeatId): readonly T11Mark[] {
  return marks.filter((m) => m.holder === seat)
}

export function unallocatedMarks(marks: readonly T11Mark[]): readonly T11Mark[] {
  return marks.filter((m) => m.holder === null)
}
