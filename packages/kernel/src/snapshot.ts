/**
 * 快照：状态与事件流的规范化与哈希。
 *
 * docs/15 §2.5：状态哈希基于状态的规范化文本形式计算，同时用于重放断言与 GM 快照。
 * 规范化必须消除一切偶然顺序——对象按键名排序，Map 按规范化后的键排序，Set 按规范化后的值排序。
 * 否则「同一份状态两次运行哈希不同」会伪装成规则缺陷。
 */

import type { EventRecord } from './event.ts'
import { sha256Hex } from './hash.ts'
import type { KernelState } from './state.ts'

export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`规则数值不能是 ${String(value)}`)
      // -0 与 0 在规则上没有区别，规范化为同一个文本
      return Object.is(value, -0) ? '0' : String(value)
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'bigint':
      return `${value.toString()}n`
    case 'function':
    case 'symbol':
      throw new Error(`状态里不允许出现 ${typeof value}`)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => [canonicalize(k), canonicalize(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return `Map{${entries.map(([k, v]) => `${k}:${v}`).join(',')}}`
  }

  if (value instanceof Set) {
    const items = [...value]
      .map(canonicalize)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return `Set{${items.join(',')}}`
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`
}

export function stateHash(state: KernelState<unknown>): string {
  return sha256Hex(canonicalize(state))
}

/**
 * 规则事件流的哈希。
 * 时间戳不参与——它是权威端逻辑时间，仅供语料对齐，不参与判定（docs/15 §2.3）。
 * 把它算进去会让「同一局在不同机器上重跑」无谓地失败。
 */
export function ruleStreamHash(events: readonly EventRecord[]): string {
  const stripped = events
    .filter((e) => e.stream === 'rule')
    .map((e) => ({
      seq: e.seq,
      levelRound: e.levelRound,
      negotiationRound: e.negotiationRound,
      phase: e.phase,
      actor: e.actor,
      type: e.type,
      payload: e.payload,
      visibility: e.visibility,
      gmOrigin: e.gmOrigin,
    }))
  return sha256Hex(canonicalize(stripped))
}

/** GM 与验证层导出的一局快照（docs/15 §9）。 */
export interface MatchSnapshot {
  readonly version: string
  readonly seed: number
  readonly drawCount: number
  readonly lastSeq: number
  /** 整局是否含 GM 来源事件。为真时结算结果不写入正式余命账本。 */
  readonly gmMatch: boolean
  readonly stateHash: string
  readonly ruleStreamHash: string
  readonly canonicalState: string
}
