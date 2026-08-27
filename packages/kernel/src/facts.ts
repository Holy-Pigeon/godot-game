/**
 * 事实投影：对规则事件流的只读查询。
 *
 * docs/15 §3.1 ⚠：构造必须是常数时间（引用日志，而不是拷贝）。
 * 批量模拟会反复调用投影查询，逐次拷贝会让整场模拟退化成二次复杂度。
 *
 * docs/15 §4 三条实现纪律：
 *   1. 只读规则事件流，不读语料流、不读推断结果（docs/13 隔离第 1 条）。
 *   2. 必须可判定：返回确定值或空。
 *   3. 可缓存但必须能从零重建。MVP 不加缓存——一局的事件量在数百条量级，
 *      线性扫描不是瓶颈；等批量模拟真的压出瓶颈再加，并同时补「缓存与重放一致」的测试。
 *
 * docs/15 §4 末尾：密令的达成条件和回响的激活条件是同一种东西，
 * 所以这些投影放在共享层上，不写死在密令模块内部。
 */

import type { EventRecord } from './event.ts'
import type { EventLog } from './log.ts'
import type { SeatId } from './state.ts'

/** 查询窗口。字段全部可选，省略即不限制。 */
export interface FactWindow {
  readonly levelRound?: number
  readonly negotiationRound?: number
  /** 序号闭区间下界。 */
  readonly fromSeq?: number
  /** 序号闭区间上界。 */
  readonly toSeq?: number
}

function withinWindow(event: EventRecord, window: FactWindow | undefined): boolean {
  if (window === undefined) return true
  if (window.levelRound !== undefined && event.levelRound !== window.levelRound) return false
  if (window.negotiationRound !== undefined && event.negotiationRound !== window.negotiationRound) return false
  if (window.fromSeq !== undefined && event.seq < window.fromSeq) return false
  if (window.toSeq !== undefined && event.seq > window.toSeq) return false
  return true
}

export class FactProjection {
  readonly #log: EventLog

  /** O(1)：只持引用。 */
  constructor(log: EventLog) {
    this.#log = log
  }

  /** 规则事件流。语料流在此不可达——这是隔离约束的实现，不是疏忽。 */
  get ruleEvents(): readonly EventRecord[] {
    return this.#log.ruleEvents
  }

  ofType<P = unknown>(type: string, window?: FactWindow): readonly EventRecord<P>[] {
    return this.#log.ruleEvents.filter(
      (e) => e.type === type && withinWindow(e, window),
    ) as readonly EventRecord<P>[]
  }

  countOfType(type: string, window?: FactWindow): number {
    return this.ofType(type, window).length
  }

  lastOfType<P = unknown>(type: string, window?: FactWindow): EventRecord<P> | undefined {
    const matches = this.ofType<P>(type, window)
    return matches[matches.length - 1]
  }

  firstOfType<P = unknown>(type: string, window?: FactWindow): EventRecord<P> | undefined {
    return this.ofType<P>(type, window)[0]
  }

  existsOfType(type: string, window?: FactWindow): boolean {
    return this.#log.ruleEvents.some((e) => e.type === type && withinWindow(e, window))
  }

  byActor<P = unknown>(actor: SeatId, window?: FactWindow): readonly EventRecord<P>[] {
    return this.#log.ruleEvents.filter(
      (e) => e.actor === actor && withinWindow(e, window),
    ) as readonly EventRecord<P>[]
  }

  /** 按谓词筛选。调用方负责保证谓词是纯函数。 */
  where<P = unknown>(
    predicate: (event: EventRecord<P>) => boolean,
    window?: FactWindow,
  ): readonly EventRecord<P>[] {
    return this.#log.ruleEvents.filter(
      (e) => withinWindow(e, window) && predicate(e as EventRecord<P>),
    ) as readonly EventRecord<P>[]
  }

  /** 取事件的序号列表。密令判定的「证据强制引用」用它产出引用（docs/13）。 */
  static seqsOf(events: readonly EventRecord[]): readonly number[] {
    return events.map((e) => e.seq)
  }
}
