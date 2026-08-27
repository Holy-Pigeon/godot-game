/**
 * 运行时：唯一写路径的编排者（docs/15 §2.2、§2.6）。
 *
 *   命令 → 校验（读状态，产出拒绝理由或事件列表）
 *        → 追加日志（分配序号、时间戳、可见性）
 *        → 归约（改状态）
 *        → 广播给订阅者（表现层 / 日志 / 渴望引擎 / 推断管线）
 *
 * 任何绕过这条路径修改状态的代码都是缺陷。状态只以 DeepReadonly 暴露，
 * 可变引用只在 #commit 里交给 template.reduce。
 */

import type { Command, CommandResult } from './command.ts'
import type { EventDraft, EventRecord } from './event.ts'
import { EventLog } from './log.ts'
import { FactProjection } from './facts.ts'
import { SeededRandom } from './random.ts'
import type { MatchSnapshot } from './snapshot.ts'
import { canonicalize, ruleStreamHash, stateHash } from './snapshot.ts'
import type { DeepReadonly, KernelState, PhaseId, SeatId } from './state.ts'
import type { PhaseDeclaration, Template, TemplateContext } from './template.ts'

export interface SeatSetup {
  readonly id: SeatId
  /** 入场余命。docs/15 §12：MVP 单局闭环，余命由外部注入。 */
  readonly lifespan: number
}

export interface RuntimeOptions {
  readonly seed: number
  readonly seats: readonly SeatSetup[]
  /**
   * 权威端逻辑时间源。默认是一个从 0 开始的逻辑计数器——
   * 内核不读系统时间（§2.4 第 4 条），离线模拟因此完全确定。
   * 会话层可以传真实时钟，时间戳只用于语料对齐，不参与判定。
   */
  readonly clock?: () => number
}

export type Subscriber = (event: EventRecord) => void

/** 自动推进的收敛上限。超过即认定模板的推进函数写错了，不静默转圈。 */
const MAX_ADVANCE_STEPS = 10_000

export function buildInitialState<S>(template: Template<S>, seats: readonly SeatSetup[]): KernelState<S> {
  const phases = template.phases()
  const first = phases[0]
  if (first === undefined) throw new Error(`模板 ${template.id} 没有声明任何阶段`)

  const { min, max } = template.seatRange
  if (seats.length < min || seats.length > max) {
    throw new Error(`模板 ${template.id} 要求 ${min}–${max} 人，实际 ${seats.length} 人`)
  }

  const ordered = [...seats].sort((a, b) => a.id - b.id)
  for (const s of ordered) {
    if (!Number.isInteger(s.lifespan) || s.lifespan < 0) {
      throw new Error(`座位 ${s.id} 的入场余命必须是非负整数：${s.lifespan}`)
    }
  }

  return {
    seats: ordered.map((s) => ({ id: s.id, lifespan: s.lifespan, fallen: s.lifespan === 0 })),
    levelRound: 0,
    negotiationRound: 0,
    phase: first.id,
    template: template.initialState(ordered.map((s) => s.id)),
  }
}

export class Runtime<S> {
  readonly #template: Template<S>
  readonly #state: KernelState<S>
  readonly #log = new EventLog()
  readonly #random: SeededRandom
  readonly #facts: FactProjection
  readonly #subscribers = new Set<Subscriber>()
  readonly #clock: () => number
  readonly #seed: number
  readonly #phaseIndex: ReadonlyMap<PhaseId, PhaseDeclaration>
  #gmMatch = false
  #opened = false

  constructor(template: Template<S>, options: RuntimeOptions) {
    this.#template = template
    this.#seed = options.seed
    this.#random = new SeededRandom(options.seed)
    this.#facts = new FactProjection(this.#log)
    this.#state = buildInitialState(template, options.seats)
    this.#phaseIndex = new Map(template.phases().map((p) => [p.id, p]))

    if (options.clock !== undefined) {
      this.#clock = options.clock
    } else {
      let tick = 0
      this.#clock = () => tick++
    }
  }

  get state(): DeepReadonly<KernelState<S>> {
    return this.#state as DeepReadonly<KernelState<S>>
  }

  get log(): EventLog {
    return this.#log
  }

  get facts(): FactProjection {
    return this.#facts
  }

  get seed(): number {
    return this.#seed
  }

  /** 整局是否含 GM 来源事件。为真时结算结果不写入正式余命账本（docs/15 §9）。 */
  get gmMatch(): boolean {
    return this.#gmMatch
  }

  get currentPhase(): PhaseDeclaration {
    const phase = this.#phaseIndex.get(this.#state.phase)
    if (phase === undefined) throw new Error(`阶段表里没有阶段 ${this.#state.phase}`)
    return phase
  }

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }

  /** 开局。只能调用一次。 */
  open(): readonly EventRecord[] {
    if (this.#opened) throw new Error('开局只能执行一次')
    this.#opened = true
    const drafts = this.#template.open(this.state, this.#context())
    const events = drafts.map((d) => this.#commit(d, false))
    return [...events, ...this.advance()]
  }

  submit(command: Command): CommandResult {
    if (!this.#opened) return { ok: false, reason: '对局尚未开局' }
    if (this.#template.isComplete(this.state)) return { ok: false, reason: '对局已结束' }

    // GM 命令跳过阶段准入表，但仍要过模板校验——docs/15 §9：
    // GM 操作也走命令 → 事件，只是带 GM 来源标记，因此同样可重放。
    if (!command.gmOrigin && !this.currentPhase.accepts.includes(command.type)) {
      return { ok: false, reason: `阶段「${this.currentPhase.label}」不接受命令 ${command.type}` }
    }

    const validation = this.#template.validate(this.state, command)
    if (!validation.ok) return { ok: false, reason: validation.reason }

    const drafts = this.#template.produce(this.state, command, this.#context())
    const events = drafts.map((d) => this.#commit(d, command.gmOrigin))
    return { ok: true, events: [...events, ...this.advance()] }
  }

  /** 自动推进到需要等待命令、或对局结束为止。走的是同一条写路径（§2.2）。 */
  advance(): readonly EventRecord[] {
    const produced: EventRecord[] = []
    let steps = 0
    while (!this.#template.isComplete(this.state)) {
      const drafts = this.#template.advance(this.state, this.#context())
      if (drafts.length === 0) break
      for (const draft of drafts) produced.push(this.#commit(draft, false))
      if (++steps > MAX_ADVANCE_STEPS) {
        throw new Error(`模板 ${this.#template.id} 的自动推进在 ${MAX_ADVANCE_STEPS} 步内未收敛`)
      }
    }
    return produced
  }

  get isComplete(): boolean {
    return this.#template.isComplete(this.state)
  }

  snapshot(version: string): MatchSnapshot {
    return {
      version,
      seed: this.#seed,
      drawCount: this.#random.drawCount,
      lastSeq: this.#log.lastSeq,
      gmMatch: this.#gmMatch,
      stateHash: stateHash(this.#state),
      ruleStreamHash: ruleStreamHash(this.#log.ruleEvents),
      canonicalState: canonicalize(this.#state),
    }
  }

  #context(): TemplateContext {
    return { random: this.#random, facts: this.#facts }
  }

  #commit(draft: EventDraft, gmOrigin: boolean): EventRecord {
    const event: EventRecord = {
      seq: this.#log.allocateSeq(),
      timestampMs: this.#clock(),
      // 上下文是「提交时」的快照：同一批 draft 里，前一条改了阶段，后一条记的就是新阶段
      levelRound: this.#state.levelRound,
      negotiationRound: this.#state.negotiationRound,
      phase: this.#state.phase,
      actor: draft.actor ?? null,
      type: draft.type,
      payload: draft.payload,
      stream: draft.stream,
      visibility: draft.visibility,
      gmOrigin,
    }
    this.#log.append(event)
    this.#template.reduce(this.#state, event)
    if (gmOrigin) this.#gmMatch = true
    for (const subscriber of this.#subscribers) subscriber(event)
    return event
  }
}

/**
 * 重放（docs/15 §2.5）：按序对规则事件执行归约，不调用校验、不调用推进、不触碰随机源。
 * 因此重放天然不受会话层、表现层、机器人策略影响。
 */
export function replay<S>(
  template: Template<S>,
  seats: readonly SeatSetup[],
  ruleEvents: readonly EventRecord[],
): KernelState<S> {
  const state = buildInitialState(template, seats)
  const ordered = [...ruleEvents].sort((a, b) => a.seq - b.seq)
  for (const event of ordered) {
    if (event.stream !== 'rule') throw new Error(`重放只接受规则事件，收到 ${event.stream}`)
    template.reduce(state, event)
  }
  return state
}
