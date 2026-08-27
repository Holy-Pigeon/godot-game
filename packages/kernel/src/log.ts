/**
 * 事件日志：双流存放、共享序号轴、按序号窗口查询。
 *
 * docs/15 §2.3：序号由单一计数器分配，两条流共用同一条序号轴但分开存放。
 * 因此「删掉行为语料流后重放」就是只读 ruleEvents，不需要任何过滤逻辑。
 *
 * docs/13：分析入口必须能按序号窗口取出一句话前后的规则事件——
 * 脱离上下文推不出意图。窗口查询由 contextAround 提供。
 */

import type { EventRecord } from './event.ts'

export class EventLog {
  #rule: EventRecord[] = []
  #corpus: EventRecord[] = []
  #nextSeq = 1

  /** 分配下一个序号。整局单调递增、不复用、两流共用。 */
  allocateSeq(): number {
    return this.#nextSeq++
  }

  /** 当前已分配到的最大序号。 */
  get lastSeq(): number {
    return this.#nextSeq - 1
  }

  append(event: EventRecord): void {
    if (event.seq >= this.#nextSeq) {
      throw new Error(`事件序号 ${event.seq} 未经 allocateSeq 分配`)
    }
    if (event.stream === 'rule') this.#rule.push(event)
    else this.#corpus.push(event)
  }

  /** 规则事件流。结算与重放只读它。 */
  get ruleEvents(): readonly EventRecord[] {
    return this.#rule
  }

  /** 行为语料流。只供局后推断，不参与任何判定。 */
  get corpusEvents(): readonly EventRecord[] {
    return this.#corpus
  }

  /** 两条流按序号归并。仅供导出与展示，判定不得使用。 */
  merged(): readonly EventRecord[] {
    return [...this.#rule, ...this.#corpus].sort((a, b) => a.seq - b.seq)
  }

  ruleEventsOfType(type: string): readonly EventRecord[] {
    return this.#rule.filter((e) => e.type === type)
  }

  /** 序号闭区间 [from, to] 内的规则事件。 */
  ruleEventsInRange(from: number, to: number): readonly EventRecord[] {
    return this.#rule.filter((e) => e.seq >= from && e.seq <= to)
  }

  /**
   * 取某条记录前后的规则事件上下文（docs/13 时序与对齐）。
   * 「我扛」在无人承担时说和在四枚已有主时说，含义相反——所以窗口取的是规则事件。
   */
  contextAround(seq: number, before: number, after: number): readonly EventRecord[] {
    return this.ruleEventsInRange(seq - before, seq + after)
  }

  /** 从既有事件重建日志，用于重放与持久化恢复。 */
  static from(ruleEvents: readonly EventRecord[], corpusEvents: readonly EventRecord[] = []): EventLog {
    const log = new EventLog()
    log.#rule = [...ruleEvents].sort((a, b) => a.seq - b.seq)
    log.#corpus = [...corpusEvents].sort((a, b) => a.seq - b.seq)
    const maxSeq = Math.max(0, ...log.#rule.map((e) => e.seq), ...log.#corpus.map((e) => e.seq))
    log.#nextSeq = maxSeq + 1
    return log
  }
}
