/**
 * 会话层线协议：命令上行、事件下行、断线补发。
 *
 * 下行的永远是**已按座位过滤**的事件（docs/15 §8）。客户端拿到什么就能看到什么，
 * 抓包读不到潜规则量是验收标准，不是「界面上不显示」。
 */

import type { EventRecord, SeatId } from '@terminus/kernel'

export const PROTOCOL_VERSION = 1

// ─────────────────────────── 上行 ───────────────────────────

export type ClientMessage =
  /** 加入房间。房间不存在时由服务端创建。 */
  | { readonly kind: 'join'; readonly roomCode: string; readonly displayName: string }
  /** 断线重连：带上已收到的最大序号，服务端补发之后的增量。 */
  | { readonly kind: 'resume'; readonly token: string; readonly lastSeq: number }
  /** 房主开始对局，空位由机器人补齐。 */
  | { readonly kind: 'start' }
  /** 提交一条命令。actor 由服务端按连接身份填充，客户端无法伪造。 */
  | { readonly kind: 'command'; readonly type: string; readonly payload: unknown }

// ─────────────────────────── 下行 ───────────────────────────

export interface RoomPlayerView {
  readonly seat: SeatId
  readonly displayName: string
  readonly connected: boolean
  readonly isBot: boolean
}

export interface RoomView {
  readonly roomCode: string
  readonly templateId: string
  readonly seatCount: number
  readonly players: readonly RoomPlayerView[]
  readonly started: boolean
  readonly hostSeat: SeatId | null
}

export type ServerMessage =
  | {
      readonly kind: 'joined'
      readonly seat: SeatId
      /** 断线重连凭据。仅本连接可见。 */
      readonly token: string
      readonly room: RoomView
      readonly protocolVersion: number
    }
  /** 已过滤的事件增量，按 seq 升序。 */
  | { readonly kind: 'events'; readonly events: readonly EventRecord[] }
  | { readonly kind: 'room'; readonly room: RoomView }
  /** 命令被拒绝，附内核给出的理由。 */
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'error'; readonly message: string }
  /** 当前阶段的剩余时间，供客户端显示倒计时。计时在服务端，客户端只是显示。 */
  | { readonly kind: 'timer'; readonly phaseId: string; readonly endsAtMs: number }

export function encode(message: ServerMessage | ClientMessage): string {
  return JSON.stringify(message)
}

export function decodeClientMessage(raw: string): ClientMessage {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    throw new Error('报文缺少 kind 字段')
  }
  return parsed as ClientMessage
}

export function decodeServerMessage(raw: string): ServerMessage {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    throw new Error('报文缺少 kind 字段')
  }
  return parsed as ServerMessage
}
