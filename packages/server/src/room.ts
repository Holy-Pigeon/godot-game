/**
 * 房间：一局对局的会话层承载（docs/15 §1 会话层）。
 *
 * 职责严格限定为四件事：权威端、命令上行、事件下行、可见性过滤与计时。
 * 规则一条都不在这里——所有判定都由内核的唯一写路径完成。
 */

import { Runtime, command, visibleTo, type EventRecord, type SeatId, type SeatSetup } from '@terminus/kernel'
import { T11Template, T11_COMMANDS, type T11State } from '@terminus/templates'
import { T11Bot } from '@terminus/sim'
import type { RoomPlayerView, RoomView } from '@terminus/protocol'

export interface RoomOptions {
  readonly roomCode: string
  readonly seatCount: number
  readonly lifespan: number
  readonly seed: number
  /** 每个阶段的超时时长由模板的阶段表给出，这里只放全局开关。 */
  readonly enableTimers: boolean
}

export interface Occupant {
  readonly seat: SeatId
  displayName: string
  connected: boolean
  isBot: boolean
  token: string
  /** 该座位已下发到的最大序号，断线重连据此补发。 */
  deliveredSeq: number
}

export type EventSink = (seat: SeatId, events: readonly EventRecord[]) => void

export class Room {
  readonly code: string
  readonly templateId = 't11'
  readonly #options: RoomOptions
  readonly #occupants = new Map<SeatId, Occupant>()
  readonly #bots = new Map<SeatId, T11Bot>()
  #runtime: Runtime<T11State> | null = null
  #started = false
  #hostSeat: SeatId | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #sink: EventSink = () => {}
  /** 全量事件日志的镜像，用于断线补发。可见性过滤在下发时做。 */
  readonly #history: EventRecord[] = []

  constructor(options: RoomOptions) {
    this.code = options.roomCode
    this.#options = options
    for (let seat = 1; seat <= options.seatCount; seat++) {
      this.#occupants.set(seat, {
        seat,
        displayName: `空位 ${seat}`,
        connected: false,
        isBot: false,
        token: `${options.roomCode}-${seat}-${options.seed}`,
        deliveredSeq: 0,
      })
    }
  }

  onEvents(sink: EventSink): void {
    this.#sink = sink
  }

  get started(): boolean {
    return this.#started
  }

  get runtime(): Runtime<T11State> | null {
    return this.#runtime
  }

  get isComplete(): boolean {
    return this.#runtime?.isComplete ?? false
  }

  view(): RoomView {
    const players: RoomPlayerView[] = [...this.#occupants.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((o) => ({
        seat: o.seat,
        displayName: o.displayName,
        connected: o.connected,
        isBot: o.isBot,
      }))
    return {
      roomCode: this.code,
      templateId: this.templateId,
      seatCount: this.#options.seatCount,
      players,
      started: this.#started,
      hostSeat: this.#hostSeat,
    }
  }

  /** 占一个空座。返回 null 表示满员。 */
  join(displayName: string): Occupant | null {
    if (this.#started) return null
    for (const occupant of [...this.#occupants.values()].sort((a, b) => a.seat - b.seat)) {
      if (!occupant.connected && !occupant.isBot) {
        occupant.displayName = displayName
        occupant.connected = true
        if (this.#hostSeat === null) this.#hostSeat = occupant.seat
        return occupant
      }
    }
    return null
  }

  occupantByToken(token: string): Occupant | undefined {
    return [...this.#occupants.values()].find((o) => o.token === token)
  }

  occupant(seat: SeatId): Occupant | undefined {
    return this.#occupants.get(seat)
  }

  markDisconnected(seat: SeatId): void {
    const occupant = this.#occupants.get(seat)
    if (occupant !== undefined) occupant.connected = false
  }

  /** 开始对局，空位由机器人补齐（docs/15 §10 的机器人同时服务于批量模拟）。 */
  start(): void {
    if (this.#started) return
    this.#started = true

    for (const occupant of this.#occupants.values()) {
      if (!occupant.connected) {
        occupant.isBot = true
        occupant.displayName = `机器人 ${occupant.seat}`
        this.#bots.set(occupant.seat, new T11Bot(occupant.seat, this.#options.seed))
      }
    }

    const seats: readonly SeatSetup[] = [...this.#occupants.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((o) => ({ id: o.seat, lifespan: this.#options.lifespan }))

    this.#runtime = new Runtime<T11State>(new T11Template() as never, {
      seed: this.#options.seed,
      seats,
      // 会话层提供真实时钟；内核自己不读系统时间（docs/15 §2.4 第 4 条）
      clock: () => Date.now(),
    })

    this.#runtime.subscribe((event) => {
      this.#history.push(event)
    })

    this.#deliver(this.#runtime.open())
    this.#driveBots()
    this.#armTimer()
  }

  /** 提交一条玩家命令。actor 由座位身份决定，客户端无法伪造。 */
  submit(seat: SeatId, type: string, payload: unknown): { ok: boolean; reason?: string } {
    const runtime = this.#runtime
    if (runtime === null) return { ok: false, reason: '对局尚未开始' }

    const before = this.#history.length
    const result = runtime.submit(command(type, seat, payload))
    this.#deliver(this.#history.slice(before))

    if (!result.ok) return { ok: false, reason: result.reason }

    this.#driveBots()
    this.#armTimer()
    return { ok: true }
  }

  /**
   * 补发某座位尚未收到的事件（断线重连）。
   * 真人局没有这条就没法玩，因此第一版就必须有。
   */
  backfill(seat: SeatId, lastSeq: number): readonly EventRecord[] {
    const occupant = this.#occupants.get(seat)
    const visible = this.#history.filter((e) => e.seq > lastSeq && visibleTo(e.visibility, seat))
    if (occupant !== undefined) {
      occupant.deliveredSeq = Math.max(occupant.deliveredSeq, this.#history.at(-1)?.seq ?? lastSeq)
    }
    return visible
  }

  dispose(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
  }

  /** 当前阶段的超时时刻，供客户端显示倒计时。 */
  phaseDeadline(): { phaseId: string; endsAtMs: number } | null {
    const runtime = this.#runtime
    if (runtime === null || runtime.isComplete || !this.#options.enableTimers) return null
    const phase = runtime.currentPhase
    if (phase.advance.kind !== 'timed') return null
    return { phaseId: phase.id, endsAtMs: Date.now() + phase.advance.timeoutMs }
  }

  /**
   * 可见性过滤后下发（docs/15 §8）。
   * 每个座位只拿到 visibleTo 为真的事件；serverOnly 事件对所有座位都不下发。
   */
  #deliver(events: readonly EventRecord[]): void {
    if (events.length === 0) return
    for (const occupant of this.#occupants.values()) {
      if (occupant.isBot) continue
      const visible = events.filter((e) => visibleTo(e.visibility, occupant.seat))
      if (visible.length === 0) continue
      occupant.deliveredSeq = visible.at(-1)?.seq ?? occupant.deliveredSeq
      this.#sink(occupant.seat, visible)
    }
  }

  /** 让机器人把该走的步走完。机器人直接走同一条命令路径，不走捷径。 */
  #driveBots(): void {
    const runtime = this.#runtime
    if (runtime === null) return

    let guard = 0
    let acted = true
    while (acted && !runtime.isComplete) {
      acted = false
      for (const bot of this.#bots.values()) {
        if (runtime.isComplete) break
        const next = bot.decide(runtime.state)
        if (next === null) continue
        const before = this.#history.length
        const result = runtime.submit(next)
        this.#deliver(this.#history.slice(before))
        if (result.ok) acted = true
      }
      if (++guard > 1000) throw new Error('机器人推进未收敛')
    }
  }

  /** 阶段计时：到点由会话层提交一个超时命令进内核。 */
  #armTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    const deadline = this.phaseDeadline()
    if (deadline === null) return

    const runtime = this.#runtime
    if (runtime === null) return
    const phaseAtArm = runtime.state.phase
    const seqAtArm = runtime.log.lastSeq

    this.#timer = setTimeout(
      () => {
        const current = this.#runtime
        if (current === null || current.isComplete) return
        // 阶段已经推进过就不再补超时，避免误伤下一阶段
        if (current.state.phase !== phaseAtArm || current.log.lastSeq !== seqAtArm) {
          this.#armTimer()
          return
        }
        const before = this.#history.length
        current.submit(command(T11_COMMANDS.timeout, null, {}))
        this.#deliver(this.#history.slice(before))
        this.#driveBots()
        this.#armTimer()
      },
      Math.max(0, deadline.endsAtMs - Date.now()),
    )
  }
}
