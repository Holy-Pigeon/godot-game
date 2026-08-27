/**
 * 事件：已经发生的事实，是改变状态的唯一途径（docs/15 §2.1）。
 *
 * 结构对齐 docs/15 §2.3 与 docs/13「两条流」：规则事件流与行为语料流
 * 共用同一条单调递增的序号轴，但分开存放——于是「删掉行为语料流」
 * 在存储层面就是删一份数据，而不是过滤。
 */

import type { PhaseId, SeatId } from './state.ts'

export type Stream = 'rule' | 'corpus'

/**
 * 可见性。docs/15 §8：权威端持有全部状态，客户端只收到过滤后的事件。
 * serverOnly 用于潜规则内部量（共同决策轮数、门环含义、完美判定概率），永不下发。
 */
export type Visibility =
  | { readonly kind: 'public' }
  | { readonly kind: 'self'; readonly seat: SeatId }
  | { readonly kind: 'list'; readonly seats: readonly SeatId[] }
  | { readonly kind: 'serverOnly' }

export const PUBLIC: Visibility = { kind: 'public' }
export const SERVER_ONLY: Visibility = { kind: 'serverOnly' }
export const selfOnly = (seat: SeatId): Visibility => ({ kind: 'self', seat })
export const toSeats = (seats: readonly SeatId[]): Visibility => ({
  kind: 'list',
  seats: [...seats].sort((a, b) => a - b),
})

export interface EventRecord<P = unknown> {
  /** 整局单调递增、不复用。两条流共用同一条轴。 */
  readonly seq: number
  /** 权威端逻辑时间，仅供语料对齐，不参与判定（docs/15 §2.3）。 */
  readonly timestampMs: number
  readonly levelRound: number
  readonly negotiationRound: number
  readonly phase: PhaseId
  /** 座位标识；系统事件为 null。 */
  readonly actor: SeatId | null
  readonly type: string
  readonly payload: P
  readonly stream: Stream
  readonly visibility: Visibility
  /** 是否由验证层注入。含 GM 来源事件的整局标记为 GM 局（docs/15 §9）。 */
  readonly gmOrigin: boolean
}

/**
 * 事件草稿：模板产出的是它，不是完整记录。
 *
 * 序号、时间戳与上下文快照（关卡轮次 / 协商轮 / 阶段）由运行时统一分配，
 * 模板不得自行填写——这是「唯一写路径」在类型上的体现。
 */
export interface EventDraft<P = unknown> {
  readonly type: string
  readonly payload: P
  readonly stream: Stream
  readonly visibility: Visibility
  /** 省略表示系统事件。 */
  readonly actor?: SeatId | null
}

export function ruleEvent<P>(
  type: string,
  payload: P,
  visibility: Visibility = PUBLIC,
  actor: SeatId | null = null,
): EventDraft<P> {
  return { type, payload, stream: 'rule', visibility, actor }
}

export function corpusEvent<P>(
  type: string,
  payload: P,
  visibility: Visibility,
  actor: SeatId | null,
): EventDraft<P> {
  return { type, payload, stream: 'corpus', visibility, actor }
}

/** 该事件是否对指定座位可见。serverOnly 对任何座位都不可见。 */
export function visibleTo(visibility: Visibility, seat: SeatId): boolean {
  switch (visibility.kind) {
    case 'public':
      return true
    case 'self':
      return visibility.seat === seat
    case 'list':
      return visibility.seats.includes(seat)
    case 'serverOnly':
      return false
  }
}
