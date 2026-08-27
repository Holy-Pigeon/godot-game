/**
 * 命令：玩家或 GM 的意图，可以被拒绝，本身不改变状态（docs/15 §2.1）。
 */

import type { EventRecord } from './event.ts'
import type { SeatId } from './state.ts'

export interface Command<P = unknown> {
  readonly type: string
  /** 发起者座位；GM 与系统命令为 null。 */
  readonly actor: SeatId | null
  readonly payload: P
  /** GM 来源标记。docs/15 §9：GM 操作也走命令 → 事件，只是带标记。 */
  readonly gmOrigin: boolean
}

export function command<P>(
  type: string,
  actor: SeatId | null,
  payload: P,
  gmOrigin = false,
): Command<P> {
  return { type, actor, payload, gmOrigin }
}

/** 校验结果：接受，或带理由的拒绝。 */
export type Validation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

export const accept: Validation = { ok: true }
export const reject = (reason: string): Validation => ({ ok: false, reason })

/** 提交结果：成功时带本次产生的全部事件，失败时带拒绝理由。 */
export type CommandResult =
  | { readonly ok: true; readonly events: readonly EventRecord[] }
  | { readonly ok: false; readonly reason: string }
