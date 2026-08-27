/**
 * 模板接口（docs/15 §3.1）。
 *
 * 内核层不引用任何具体模板的符号——这是「横向扩展关卡」能力的唯一实质保障（§1 硬规则 1）。
 * 本文件只声明契约，不认识灾痕、协商轮或任何 T-11 词汇。
 */

import type { AnchorBindings, PredicateBindings, TraumaBindings } from './bindings.ts'
import type { Command, Validation } from './command.ts'
import type { EventDraft, EventRecord } from './event.ts'
import type { FactProjection } from './facts.ts'
import type { SeededRandom } from './random.ts'
import type { DeepReadonly, KernelState, PhaseId, SeatId } from './state.ts'

/**
 * 产出与推进的上下文。
 *
 * docs/15 §3.1：事实投影必须传给开局 / 产出 / 推进——密令求值与将来的回响激活判定
 * 都需要读事件历史，而它们都发生在模板内部。
 */
export interface TemplateContext {
  readonly random: SeededRandom
  readonly facts: FactProjection
}

/** 阶段的推进方式。docs/15 §7.1 要求阶段落成一张数据表，而不是一串分支。 */
export type PhaseAdvance =
  /** 立即推进，不接受命令。 */
  | { readonly kind: 'immediate' }
  /** 等待命令，由模板自行判断何时推进。 */
  | { readonly kind: 'awaitCommands' }
  /** 全员就绪或超时。超时由会话层计时，以一个事件进入内核（§2.4 第 4 条）。 */
  | { readonly kind: 'timed'; readonly timeoutMs: number }

export interface PhaseDeclaration {
  readonly id: PhaseId
  /** 面向玩家的阶段名。表现层直接展示，内核不解释。 */
  readonly label: string
  /** 本阶段接受的命令类型。不在表内的命令一律拒绝。 */
  readonly accepts: readonly string[]
  readonly advance: PhaseAdvance
}

/**
 * 结算声明：经济核算的声明式描述（§3.1）。
 *
 * 有了它，docs/02 的回收等级与系统净回收可以由通用代码从事件流算出，
 * 每个模板不必各写一遍核算逻辑。
 */
export interface SettlementDeclaration {
  /** 每人固定门票，整数日。 */
  readonly ticketPerSeat: number
  /** 系统回收余命的事件类型（门票之外）。载荷需含实际回收额。 */
  readonly recoveryEventTypes: readonly string[]
  /** 系统发放余命的事件类型。载荷需含实际发放额。 */
  readonly awardEventTypes: readonly string[]
  /** 规则致死的事件类型。 */
  readonly deathEventType: string
  /** 每名规则致死者计入回收等级的余命等值。docs/02 固定为 10。 */
  readonly deathEquivalent: number
}

export interface Template<S = unknown> {
  readonly id: string
  readonly seatRange: { readonly min: number; readonly max: number }

  /** 阶段表。第一项是初始阶段。 */
  phases(): readonly PhaseDeclaration[]

  /** 确定性骨架；不得使用随机（§3.1）。余命由外部注入，不在这里决定。 */
  initialState(seats: readonly SeatId[]): S

  /** 开局。随机结果必须写进事件载荷（§2.4 第 2 条）。 */
  open(state: DeepReadonly<KernelState<S>>, ctx: TemplateContext): readonly EventDraft[]

  validate(state: DeepReadonly<KernelState<S>>, command: Command): Validation

  produce(
    state: DeepReadonly<KernelState<S>>,
    command: Command,
    ctx: TemplateContext,
  ): readonly EventDraft[]

  /** 纯函数：无随机、无 IO、无时间。这是唯一能改状态的地方。 */
  reduce(state: KernelState<S>, event: EventRecord): void

  /** 返回空列表表示当前需要等待命令（§2.2）。 */
  advance(state: DeepReadonly<KernelState<S>>, ctx: TemplateContext): readonly EventDraft[]

  /** 对局是否已经走完。为真时运行时停止推进。 */
  isComplete(state: DeepReadonly<KernelState<S>>): boolean

  settlement(): SettlementDeclaration

  predicateBindings(): PredicateBindings
  anchorBindings(): AnchorBindings
  traumaBindings(): TraumaBindings
}
