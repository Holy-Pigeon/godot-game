/**
 * 会话客户端：把服务端下发的事件喂给模板提供的视图投影。
 *
 * docs/15 §1：表现层只订阅事件、不读状态、不含任何规则。
 * 因此这里没有任何判定——收到的事件已经是服务端过滤后的子集，
 * 视图投影按模板标识从注册表取，本文件不认识 T-11 的任何符号。
 */

import type { SeatId, ViewModel, ViewProjection } from '@terminus/kernel'
import { createViewProjection } from '@terminus/templates'
import {
  decodeServerMessage,
  encode,
  type ClientMessage,
  type RoomView,
} from '@terminus/protocol'
import type { Platform, PlatformSocket } from './platform/index.ts'

const TOKEN_KEY = 'terminus.token'
const SEQ_KEY = 'terminus.lastSeq'

export interface SessionCallbacks {
  onRoom(room: RoomView): void
  onView(view: ViewModel): void
  onRejected(reason: string): void
  onError(message: string): void
  onStatus(text: string): void
}

export class Session {
  readonly #platform: Platform
  readonly #callbacks: SessionCallbacks
  #socket: PlatformSocket | null = null
  #projection: ViewProjection | null = null
  #seat: SeatId | null = null
  #room: RoomView | null = null
  #lastSeq = 0

  constructor(platform: Platform, callbacks: SessionCallbacks) {
    this.#platform = platform
    this.#callbacks = callbacks
  }

  get seat(): SeatId | null {
    return this.#seat
  }

  get room(): RoomView | null {
    return this.#room
  }

  connect(url: string, roomCode: string, displayName: string): void {
    const socket = this.#platform.connect(url)
    this.#socket = socket

    socket.onOpen(() => {
      const token = this.#platform.storage.get(TOKEN_KEY)
      const storedSeq = Number(this.#platform.storage.get(SEQ_KEY) ?? 0)
      if (token !== null && token.startsWith(`${roomCode}-`)) {
        // 断线重连：带上已收到的最大序号，服务端补发之后的增量
        this.#lastSeq = storedSeq
        this.#send({ kind: 'resume', token, lastSeq: storedSeq })
        this.#callbacks.onStatus('正在恢复上次的座位…')
      } else {
        this.#send({ kind: 'join', roomCode, displayName })
        this.#callbacks.onStatus('正在加入房间…')
      }
    })

    socket.onMessage((raw) => this.#handle(raw))
    socket.onClose(() => this.#callbacks.onStatus('连接已断开，刷新页面可重连'))
    socket.onError((message) => this.#callbacks.onError(message))
  }

  start(): void {
    this.#send({ kind: 'start' })
  }

  submit(type: string, payload: Record<string, unknown>): void {
    this.#send({ kind: 'command', type, payload })
  }

  #send(message: ClientMessage): void {
    this.#socket?.send(encode(message))
  }

  #handle(raw: string): void {
    const message = decodeServerMessage(raw)

    switch (message.kind) {
      case 'joined': {
        this.#seat = message.seat
        this.#room = message.room
        this.#platform.storage.set(TOKEN_KEY, message.token)
        // 视图投影按模板标识取，表现层不引用具体模板的内部符号（docs/15 §1 硬规则 2）
        this.#projection ??= createViewProjection(message.room.templateId)
        this.#callbacks.onRoom(message.room)
        this.#callbacks.onStatus(`你是编号 ${message.seat}`)
        break
      }

      case 'room': {
        this.#room = message.room
        this.#callbacks.onRoom(message.room)
        break
      }

      case 'events': {
        const projection = this.#projection
        if (projection === null) return
        for (const event of message.events) {
          projection.apply(event)
          this.#lastSeq = Math.max(this.#lastSeq, event.seq)
        }
        this.#platform.storage.set(SEQ_KEY, String(this.#lastSeq))
        this.#callbacks.onView(projection.render(this.#seat))
        break
      }

      case 'rejected':
        this.#callbacks.onRejected(message.reason)
        break

      case 'error':
        this.#callbacks.onError(message.message)
        break

      case 'timer':
        break
    }
  }
}
