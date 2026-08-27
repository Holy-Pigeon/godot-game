/**
 * ① 谓词绑定：把平台封闭词表映射到 T-11 的事件投影（docs/15 §3.2、§4）。
 *
 * 回响永远不知道自己跑在哪个关卡里——这是它能跨模板存活的唯一原因。
 * 本文件是 T-11 这一侧的翻译，回响那一侧只认词表里的抽象谓词。
 *
 * 三条实现纪律（§4）：
 *   - 只读规则事件流，不读语料流、不读推断结果。FactProjection 本身就不暴露语料流。
 *   - 必须可判定：返回确定值或 undefined，不返回「大概」。
 *   - 投影可缓存但必须能从零重建。MVP 不缓存，全部现算。
 */

import type { KernelState, PredicateBindings, PredicateInput, SeatId } from '@terminus/kernel'
import type { LossSettledPayload, TransferRespondedPayload, VotesRevealedPayload } from './mandates.ts'
import { T11_EVENTS, actOfRound, marksHeldBy, type T11State } from './types.ts'

function templateState(input: PredicateInput): T11State {
  return (input.state as KernelState<T11State>).template
}

export function buildPredicateBindings(): PredicateBindings {
  return {
    /** x 公开表态支持某方案，最终做了相反的选择。 */
    publicStanceBetrayed: ({ facts, args }) => {
      const x = args.subject
      if (x === undefined) return undefined
      const commitments = facts
        .ofType<{ seat: SeatId }>(T11_EVENTS.approvalCommitted, args.window)
        .filter((e) => e.payload.seat === x)
      return commitments.some((commitment) => {
        const revealed = facts.lastOfType<VotesRevealedPayload>(T11_EVENTS.votesRevealed, {
          levelRound: commitment.levelRound,
          negotiationRound: commitment.negotiationRound,
        })
        return revealed?.payload.votes.find((v) => v.seat === x)?.approve === false
      })
    },

    /** 该窗口内的集体决议被否决。 */
    collectiveDecisionRejected: ({ facts, args }) =>
      facts.existsOfType(T11_EVENTS.proposalVetoed, args.window),

    /** x 承接并实际结算了本应落在我身上的代价。 */
    costAbsorbedByOther: ({ facts, args }) => {
      const x = args.subject
      const me = args.self
      if (x === undefined || me === undefined) return undefined
      const handovers = facts
        .ofType<{ markId: number; from: SeatId | null; to: SeatId }>(
          T11_EVENTS.markTransferred,
          args.window,
        )
        .filter((e) => e.payload.from === me && e.payload.to === x)
      return handovers.some((handover) =>
        facts
          .ofType<LossSettledPayload>(T11_EVENTS.lossSettled)
          .some(
            (settled) =>
              settled.seq > handover.seq &&
              (settled.payload.entries.find((entry) => entry.seat === x)?.markIds ?? []).includes(
                handover.payload.markId,
              ),
          ),
      )
    },

    /** 一次转让请求被拒。从 = 发起方（args.self），到 = 被请求方（args.subject）。 */
    transferRequestRefused: ({ facts, args }) => {
      const from = args.self
      const to = args.subject
      if (from === undefined || to === undefined) return undefined
      return facts
        .ofType<TransferRespondedPayload>(T11_EVENTS.transferResponded, args.window)
        .some((e) => e.payload.requester === from && e.payload.holder === to && !e.payload.accepted)
    },

    /** 他人向我发起的转让请求数。 */
    receivedTransferRequestCount: ({ facts, args }) => {
      const me = args.self
      if (me === undefined) return undefined
      return facts
        .ofType<{ holder: SeatId }>(T11_EVENTS.transferRequested, args.window)
        .filter((e) => e.payload.holder === me).length
    },

    /** 对象当前承担的代价单位数——本关就是当前持有的灾痕枚数。 */
    currentBurdenCount: (input) => {
      const subject = input.args.subject
      if (subject === undefined) return undefined
      return marksHeldBy(templateState(input).marks, subject).length
    },

    /**
     * 对象在存活者中的余命分位，返回 1 到 n 的整数名次（1 = 余命最低）。
     * 用整数名次而不是浮点比例，对齐 §2.4 第 1 条。
     */
    lifespanQuantile: (input) => {
      const subject = input.args.subject
      if (subject === undefined) return undefined
      const living = input.state.seats.filter((s) => !s.fallen)
      if (!living.some((s) => s.id === subject)) return undefined
      const sorted = [...living].sort((a, b) => a.lifespan - b.lifespan || a.id - b.id)
      return sorted.findIndex((s) => s.id === subject) + 1
    },

    /** 当前难度档：T-11 的三幕，取值 1 / 2 / 3。 */
    currentIntensityTier: (input) => {
      if (input.state.levelRound === 0) return undefined
      return actOfRound(input.state.levelRound)
    },
  }
}
