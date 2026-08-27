/**
 * 三张绑定表与它们两侧的平台级词表（docs/15 §3.2、§4、§5）。
 *
 *   回响侧（跨模板、跨轮回、永久）        模板侧（本关专属、可替换）
 *       抽象谓词    ←──── ① 谓词绑定 ────→   本关事件投影
 *       抽象锚点    ←──── ② 锚点绑定 ────→   本关效果动词
 *       创伤 W1–W8  ←──── ③ 创伤绑定 ────→   本关损失来源
 *
 * 词表是封闭的、平台维护的，模板不得自造（§4）。一旦放开，每个模板会各写一套
 * 自己的谓词名，同一条回响就再也换不到别的关卡里去。
 */

import type { FactProjection, FactWindow } from './facts.ts'
import type { DeepReadonly, KernelState, SeatId } from './state.ts'

// ─────────────────────────── ① 谓词词表（回响激活的输入） ───────────────────────────

/** 封闭谓词词表。键是代码标识，值是 docs/15 §4 表里的中文谓词名。 */
export const PREDICATE_VOCABULARY = {
  publicStanceBetrayed: '公开表态被背弃(x)',
  collectiveDecisionRejected: '集体决议未通过(窗口)',
  costAbsorbedByOther: '代价被他人承接(x, 我)',
  transferRequestRefused: '转让请求被拒(从, 到, 窗口)',
  receivedTransferRequestCount: '收到的转让请求数(我, 窗口)',
  currentBurdenCount: '当前承担数(对象)',
  lifespanQuantile: '余命分位(对象)',
  currentIntensityTier: '当前强度档()',
} as const

export type PredicateId = keyof typeof PREDICATE_VOCABULARY

export const ALL_PREDICATE_IDS = Object.keys(PREDICATE_VOCABULARY) as readonly PredicateId[]

export interface PredicateArgs {
  /** 谓词里的 x / 从 / 对象。 */
  readonly subject?: SeatId
  /** 谓词里的「我」/ 到。 */
  readonly self?: SeatId
  readonly window?: FactWindow
}

/**
 * 谓词求值结果。undefined 表示在当前事实下不可判定——
 * 与「未绑定」是两回事，后者由 bindings 里缺这一项表达。
 */
export type PredicateValue = boolean | number | undefined

export interface PredicateInput {
  readonly facts: FactProjection
  /** 部分谓词（当前承担数、余命分位、当前强度档）读的是此刻的状态，不是历史事件。 */
  readonly state: DeepReadonly<KernelState<unknown>>
  readonly args: PredicateArgs
}

export type PredicateBinding = (input: PredicateInput) => PredicateValue

/**
 * ① 谓词绑定：可选，逐条（§3.2）。
 * 缺失后果：依赖该谓词的回响在本关不可激活——这是合法降级，不是错误。
 */
export type PredicateBindings = Partial<Readonly<Record<PredicateId, PredicateBinding>>>

// ─────────────────────────── ② 语义锚点（回响效果的输出） ───────────────────────────

export const ANCHOR_VOCABULARY = {
  revealLockedChoice: { label: '揭示·一次已锁定的选择', tier: 'L1' },
  replayMyPublicStance: { label: '重播·我的一次公开表态', tier: 'L1' },
  divertOutcomeToMe: { label: '转嫁·一次针对我的判定后果', tier: 'L2' },
  divertMyOutcomeToSeat: { label: '转嫁·我的一次判定后果到指定编号', tier: 'L2' },
} as const

export type AnchorId = keyof typeof ANCHOR_VOCABULARY

export const ALL_ANCHOR_IDS = Object.keys(ANCHOR_VOCABULARY) as readonly AnchorId[]

/**
 * ② 锚点绑定：L1/L2 必须全实现，否则不得上架（§3.2、docs/04）。
 *
 * MVP 例外见 docs/15 §5：锚点注册表存在但为空，可用性判定恒为假。
 * 因此这里用 Partial——空注册表是 MVP 的合法状态，兼容矩阵（§3.3）会如实报出 0/4 覆盖率，
 * 是否阻断上架由调用方决定，不在类型层强制。
 */
export type AnchorBindings = Partial<Readonly<Record<AnchorId, unknown>>>

// ─────────────────────────── ③ 创伤绑定（渴望的输入） ───────────────────────────

export const TRAUMA_VOCABULARY = {
  W1: '背叛',
  W2: '无力',
  W3: '剥夺',
  W4: '欺瞒',
  W5: '弃绝',
  W6: '罪咎',
  W7: '囚禁',
  W8: '湮没',
} as const

export type TraumaId = keyof typeof TRAUMA_VOCABULARY

/**
 * ③ 创伤绑定：必需（§3.2）。
 * 缺失后果：本关不产生渴望，所有回响卡在渴望阈值上——最容易被漏掉但同样致命。
 */
export interface TraumaBinding {
  /** 本关的损失来源事件类型。 */
  readonly eventType: string
  /** 该事件喂养哪些创伤。docs/14「T-11 的创伤供给」是第一个实例。 */
  readonly feeds: readonly TraumaId[]
  /** 口径说明。docs/14 对 W6 有明确口径要求：不得绑定致人死亡。 */
  readonly note?: string
}

export type TraumaBindings = readonly TraumaBinding[]

// ─────────────────────────── §3.3 上架校验：兼容矩阵 ───────────────────────────

export interface CompatibilityMatrix {
  readonly templateId: string
  /** 已实现的锚点 / 全部 L1+L2 锚点。 */
  readonly anchorCoverage: { readonly implemented: number; readonly required: number }
  readonly missingAnchors: readonly AnchorId[]
  /** 已绑定的谓词 / 全部词表谓词。 */
  readonly predicateCoverage: { readonly bound: number; readonly total: number }
  readonly unboundPredicates: readonly PredicateId[]
  readonly hasTraumaBindings: boolean
}

export function buildCompatibilityMatrix(
  templateId: string,
  anchors: AnchorBindings,
  predicates: PredicateBindings,
  traumas: TraumaBindings,
): CompatibilityMatrix {
  const missingAnchors = ALL_ANCHOR_IDS.filter((id) => anchors[id] === undefined)
  const unboundPredicates = ALL_PREDICATE_IDS.filter((id) => predicates[id] === undefined)
  return {
    templateId,
    anchorCoverage: {
      implemented: ALL_ANCHOR_IDS.length - missingAnchors.length,
      required: ALL_ANCHOR_IDS.length,
    },
    missingAnchors,
    predicateCoverage: {
      bound: ALL_PREDICATE_IDS.length - unboundPredicates.length,
      total: ALL_PREDICATE_IDS.length,
    },
    unboundPredicates,
    hasTraumaBindings: traumas.length > 0,
  }
}

/**
 * 死条目检查（§3.3 第二条判读规则）：无任何模板绑定的谓词 = 永远不会激活的回响。
 * 不做这个检查，死条目会静悄悄躺在库里，等着某天有人报「这条回响是不是坏了」。
 */
export function deadPredicates(matrices: readonly CompatibilityMatrix[]): readonly PredicateId[] {
  if (matrices.length === 0) return ALL_PREDICATE_IDS
  return ALL_PREDICATE_IDS.filter((id) => matrices.every((m) => m.unboundPredicates.includes(id)))
}
