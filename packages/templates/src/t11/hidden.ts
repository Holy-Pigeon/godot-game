/**
 * 潜规则层（docs/12「内部潜规则」、docs/15 §7.4）。
 *
 * 独立于主流程，只订阅事件：参与灯、环形脉冲、裂纹闭合、共同决策轮四条件、门环、完美判定。
 * 主流程只从这里读 coDecisionRounds 做完美判定，不反向写入。
 *
 * 世界内反馈一律公开，但**不附带任何解释文字**（docs/15 §8）：
 * 门环只下发「转了一格」这个事件本身——信息等价，但呈现方式强迫玩家自己去数、自己去关联。
 * 计数值、含义与概率一律 serverOnly，永不下发。
 */

import {
  PUBLIC,
  SERVER_ONLY,
  ruleEvent,
  type DeepReadonly,
  type EventDraft,
  type FactProjection,
  type KernelState,
  type SeatId,
} from '@terminus/kernel'
import { T11_EVENTS, type T11State } from './types.ts'
import type { TransferRespondedPayload } from './mandates.ts'

/** 完美判定概率表（docs/12）。索引为共同决策轮数 K，值为百分比整数。 */
const PERFECT_CLEAR_PERCENT: readonly number[] = [0, 0, 0, 25, 50, 75, 100]

export function perfectClearPercent(coDecisionRounds: number): number {
  const clamped = Math.max(0, Math.min(coDecisionRounds, PERFECT_CLEAR_PERCENT.length - 1))
  return PERFECT_CLEAR_PERCENT[clamped] ?? 0
}

/**
 * 本关卡轮次真实参与过承担过程的座位（docs/12「世界内线索」第 1、2 条）。
 *
 * 点亮：首次持有灾痕、成功申请接手、同意别人从自己手中接走。
 * 不点亮：单纯发言、不选、失败的转移申请、被拒绝的申请。
 * 回响强制移动会改变持有者，但不会替任何人点亮自愿参与灯——因此这里只看
 * markAssumed 与被同意的 transferResponded，不看 markTransferred 的来源为 echoForced 的那些。
 */
export function participatedThisRound(
  facts: FactProjection,
  levelRound: number,
): readonly SeatId[] {
  const seats = new Set<SeatId>()
  const window = { levelRound }

  for (const event of facts.ofType<{ seat: SeatId }>(T11_EVENTS.markAssumed, window)) {
    seats.add(event.payload.seat)
  }
  for (const event of facts.ofType<TransferRespondedPayload>(T11_EVENTS.transferResponded, window)) {
    if (!event.payload.accepted) continue
    seats.add(event.payload.requester)
    seats.add(event.payload.holder)
  }

  return [...seats].sort((a, b) => a - b)
}

/**
 * 门环三条件（docs/12）。判定时机是方案通过时——第 3 条要读全员一致认可。
 *
 *   1. 4 枚灾痕在结算前都至少发生过一次玩家间移动
 *   2. 每名存活玩家本轮至少参与过一次承担过程
 *   3. 本轮最终由全体存活玩家一致投认可票；只达到 n−1 不计
 *
 * 三条全部可从状态读出：条件 2 的「参与过」就是参与灯的点亮条件，lamps 即是它的记录。
 * 因此本函数是纯状态函数，归约里可以直接调用，不需要事实投影。
 */
export function gateConditionsMet(
  marks: readonly { readonly hasMoved: boolean }[],
  lamps: readonly SeatId[],
  livingSeats: readonly SeatId[],
  votes: readonly { readonly seat: SeatId; readonly approve: boolean }[],
): boolean {
  if (!marks.every((m) => m.hasMoved)) return false
  if (!livingSeats.every((seat) => lamps.includes(seat))) return false
  return votes.length === livingSeats.length && votes.every((v) => v.approve)
}

/**
 * 待产出的世界内反馈。
 *
 * 一次只返回一类：运行时的 advance 会循环调用，前一批归约完再判下一批——
 * 于是「灯全亮 → 环形脉冲」这条因果顺序自然成立，不需要在这里手工排队。
 */
export function hiddenReactions(
  state: DeepReadonly<KernelState<T11State>>,
  facts: FactProjection,
): readonly EventDraft[] {
  const t = state.template
  const hidden = t.hidden
  if (state.levelRound === 0) return []

  // 1. 参与灯：本轮第一次真实参与承担时点亮，保持到本轮结束
  const participants = participatedThisRound(facts, state.levelRound)
  const toLight = participants.filter((seat) => !hidden.lamps.includes(seat))
  if (toLight.length > 0) {
    return toLight.map((seat) => ruleEvent(T11_EVENTS.participationLampLit, { seat }, PUBLIC))
  }

  // 2. 裂纹闭合：一枚灾痕首次发生玩家间移动时短暂闭合
  const toClose = t.marks.filter(
    (m) => m.hasMoved && !hidden.cracksClosedThisRound.includes(m.id),
  )
  if (toClose.length > 0) {
    return toClose.map((m) => ruleEvent(T11_EVENTS.markCrackClosed, { markId: m.id }, PUBLIC))
  }

  // 3. 环形脉冲：本轮所有存活玩家对应的灯全部点亮
  const living = state.seats.filter((s) => !s.fallen).map((s) => s.id)
  const allLit = living.length > 0 && living.every((seat) => hidden.lamps.includes(seat))
  if (allLit && !hidden.ringPulsedThisRound) {
    return [ruleEvent(T11_EVENTS.ringPulse, {}, PUBLIC)]
  }

  // 4. 门环转动：三条件同时满足。只下发「转了一格」，不下发计数与含义
  if (hidden.gateConditionsMetThisRound) {
    const turnedThisRound = facts.existsOfType(T11_EVENTS.gateRingTurned, {
      levelRound: state.levelRound,
    })
    if (!turnedThisRound) {
      return [ruleEvent(T11_EVENTS.gateRingTurned, {}, PUBLIC)]
    }
  }

  // 5. 共同决策轮：门环三条件 + 本轮无人因灾痕结算失守。仅服务端
  const roundEnded = facts.existsOfType(T11_EVENTS.levelRoundEnded, { levelRound: state.levelRound })
  if (roundEnded && hidden.gateConditionsMetThisRound && !hidden.fallenThisRound) {
    const counted = facts.existsOfType(T11_EVENTS.coDecisionRoundCounted, {
      levelRound: state.levelRound,
    })
    if (!counted) {
      return [
        ruleEvent(
          T11_EVENTS.coDecisionRoundCounted,
          { levelRound: state.levelRound },
          SERVER_ONLY,
        ),
      ]
    }
  }

  return []
}

/** 潜规则层的归约。只写 hidden 子状态，不碰主流程任何字段。 */
export function reduceHidden(state: KernelState<T11State>, eventType: string, payload: unknown): void {
  const hidden = state.template.hidden

  switch (eventType) {
    case T11_EVENTS.levelRoundStarted: {
      // 参与灯、裂纹、脉冲按关卡轮次重置；门环转动次数一经转动不会复位
      hidden.lamps = []
      hidden.cracksClosedThisRound = []
      hidden.ringPulsedThisRound = false
      hidden.fallenThisRound = false
      hidden.gateConditionsMetThisRound = false
      break
    }
    case T11_EVENTS.participationLampLit: {
      const { seat } = payload as { seat: SeatId }
      if (!hidden.lamps.includes(seat)) {
        hidden.lamps.push(seat)
        hidden.lamps.sort((a, b) => a - b)
      }
      break
    }
    case T11_EVENTS.markCrackClosed: {
      const { markId } = payload as { markId: number }
      if (!hidden.cracksClosedThisRound.includes(markId)) {
        hidden.cracksClosedThisRound.push(markId)
        hidden.cracksClosedThisRound.sort((a, b) => a - b)
      }
      break
    }
    case T11_EVENTS.ringPulse: {
      hidden.ringPulsedThisRound = true
      break
    }
    case T11_EVENTS.gateRingTurned: {
      hidden.gateRingTurns += 1
      break
    }
    case T11_EVENTS.coDecisionRoundCounted: {
      hidden.coDecisionRounds += 1
      break
    }
    case T11_EVENTS.seatFallen: {
      hidden.fallenThisRound = true
      break
    }
  }
}
