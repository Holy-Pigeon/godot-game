/**
 * T-11 的视图投影（docs/15 §1）。
 *
 * 只消费**已过滤**的事件流：它拿不到 serverOnly 事件，因此不可能把
 * 共同决策轮数、门环含义或完美判定概率渲染出来——可见性由会话层保证，
 * 本文件不需要（也无法）自行判断什么该藏。
 *
 * 世界内反馈只呈现现象，不附解释文字（docs/15 §8）：
 * 门环只显示「转了一格」，不显示计数与含义。
 */

import type {
  ActionOption,
  EventRecord,
  FeedItem,
  PublicItemView,
  SeatId,
  SeatView,
  ViewModel,
  ViewProjection,
} from '@terminus/kernel'
import { MANDATE_BY_ID } from './mandates.ts'
import type { LossSettledPayload, VotesRevealedPayload } from './mandates.ts'
import { T11_COMMANDS, T11_EVENTS, T11_PHASES, actOfRound } from './types.ts'

const PHASE_LABEL: Record<string, string> = {
  [T11_PHASES.disasterReveal]: '灾难显现',
  [T11_PHASES.sequentialAction]: '顺序行动',
  [T11_PHASES.allocationCheck]: '分配检查',
  [T11_PHASES.echoWindowAllocation]: '分配回响窗口',
  [T11_PHASES.freeExchange]: '自由交流',
  [T11_PHASES.approvalVote]: '认可投票',
  [T11_PHASES.echoWindowInformation]: '信息回响窗口',
  [T11_PHASES.voteReveal]: '投票揭晓',
  [T11_PHASES.settlementOrVeto]: '结算与否决',
  [T11_PHASES.finalSettlement]: '终局结算',
  [T11_PHASES.done]: '关卡结束',
}

interface SeatRecord {
  id: SeatId
  lifespan: number
  burden: number
  fallen: boolean
  lampLit: boolean
  committed: boolean
  ready: boolean
  voted: boolean
}

interface MarkRecord {
  id: number
  holder: SeatId | null
  crackClosed: boolean
}

/**
 * 表现层侧的状态重建。
 *
 * 这不是内核状态的副本——它只包含**这名观察者看得到的**信息，
 * 因此绝不能拿它做任何判定（docs/15 §1：表现层不含任何规则）。
 */
export class T11ViewProjection implements ViewProjection {
  #seats: SeatRecord[] = []
  #marks: MarkRecord[] = []
  #phase: string = T11_PHASES.disasterReveal
  #levelRound = 0
  #negotiationRound = 0
  #actionOrder: SeatId[] = []
  #actionCursor = 0
  #pendingHolder: SeatId | null = null
  #pendingRequester: SeatId | null = null
  #pendingMarkId: number | null = null
  #maxMarksPerSeat = 2
  #feed: FeedItem[] = []
  #myMandate: { mandateId: string; target: SeatId | null } | null = null
  #summary: string[] = []
  #complete = false
  #lossPerMark = 1

  apply(event: EventRecord): void {
    switch (event.type) {
      case T11_EVENTS.matchStarted: {
        const p = event.payload as {
          seats: readonly { seat: SeatId; entryLifespan: number }[]
          marksPerRound: number
        }
        this.#seats = p.seats.map((s) => ({
          id: s.seat,
          lifespan: s.entryLifespan,
          burden: 0,
          fallen: false,
          lampLit: false,
          committed: false,
          ready: false,
          voted: false,
        }))
        this.#push(event, `对局开始，${p.seats.length} 名编号入场`)
        break
      }

      case T11_EVENTS.ticketCharged: {
        const { entries } = event.payload as { entries: readonly { seat: SeatId; amount: number }[] }
        for (const entry of entries) {
          const seat = this.#seat(entry.seat)
          if (seat !== undefined) {
            seat.lifespan -= entry.amount
            if (seat.lifespan <= 0) {
              seat.lifespan = 0
              seat.fallen = true
            }
          }
        }
        this.#push(event, `全员支付门票 ${entries[0]?.amount ?? 0} 日`)
        break
      }

      // 密令只对本人可见，所以这条事件只会出现在本人的事件流里
      case T11_EVENTS.mandateDealt: {
        const p = event.payload as { mandateId: string; target: SeatId | null }
        this.#myMandate = { mandateId: p.mandateId, target: p.target }
        break
      }

      case T11_EVENTS.phaseEntered: {
        this.#phase = (event.payload as { phase: string }).phase
        break
      }

      case T11_EVENTS.levelRoundStarted: {
        const p = event.payload as { levelRound: number; baseLoss: number }
        this.#levelRound = p.levelRound
        this.#lossPerMark = p.baseLoss
        for (const seat of this.#seats) seat.lampLit = false
        this.#push(event, `第 ${p.levelRound} 关卡轮次开始，第 ${actOfRound(p.levelRound)} 幕，单枚基础损失 ${p.baseLoss} 日`)
        break
      }

      case T11_EVENTS.marksRevealed: {
        const { markIds } = event.payload as { markIds: readonly number[] }
        this.#marks = markIds.map((id) => ({ id, holder: null, crackClosed: false }))
        this.#push(event, `放出 ${markIds.length} 枚灾痕`)
        break
      }

      case T11_EVENTS.negotiationRoundStarted: {
        const p = event.payload as { negotiationRound: number; actionOrder: readonly SeatId[] }
        this.#negotiationRound = p.negotiationRound
        this.#actionOrder = [...p.actionOrder]
        this.#actionCursor = 0
        for (const seat of this.#seats) {
          seat.committed = false
          seat.ready = false
          seat.voted = false
        }
        if (p.negotiationRound > 1) this.#push(event, `进入第 ${p.negotiationRound} 协商轮`)
        break
      }

      case T11_EVENTS.markAssumed: {
        const p = event.payload as { seat: SeatId; markId: number }
        const mark = this.#mark(p.markId)
        if (mark !== undefined) mark.holder = p.seat
        this.#actionCursor += 1
        this.#push(event, `编号 ${p.seat} 承担了第 ${p.markId} 枚灾痕`)
        break
      }

      case T11_EVENTS.transferRequested: {
        const p = event.payload as { requester: SeatId; holder: SeatId; markId: number }
        this.#pendingRequester = p.requester
        this.#pendingHolder = p.holder
        this.#pendingMarkId = p.markId
        this.#push(event, `编号 ${p.requester} 申请接手编号 ${p.holder} 的第 ${p.markId} 枚灾痕`)
        break
      }

      case T11_EVENTS.transferResponded: {
        const p = event.payload as { requester: SeatId; holder: SeatId; accepted: boolean }
        this.#pendingRequester = null
        this.#pendingHolder = null
        this.#pendingMarkId = null
        this.#actionCursor += 1
        this.#push(event, `编号 ${p.holder} ${p.accepted ? '同意' : '拒绝'}了编号 ${p.requester} 的申请`)
        break
      }

      case T11_EVENTS.markTransferred: {
        const p = event.payload as { markId: number; to: SeatId }
        const mark = this.#mark(p.markId)
        if (mark !== undefined) mark.holder = p.to
        break
      }

      case T11_EVENTS.actionPassed:
      case T11_EVENTS.actionTimedOut: {
        const p = event.payload as { seat: SeatId }
        this.#actionCursor += 1
        this.#push(event, `编号 ${p.seat} 不选`)
        break
      }

      case T11_EVENTS.approvalCommitted: {
        const p = event.payload as { seat: SeatId }
        const seat = this.#seat(p.seat)
        if (seat !== undefined) seat.committed = true
        this.#push(event, `编号 ${p.seat} 公开承诺本轮投认可票`)
        break
      }

      case T11_EVENTS.exchangeReady: {
        const p = event.payload as { seat: SeatId }
        const seat = this.#seat(p.seat)
        if (seat !== undefined) seat.ready = true
        break
      }

      // 只有自己的锁定票会下发到自己这里
      case T11_EVENTS.voteLocked: {
        const p = event.payload as { seat: SeatId }
        const seat = this.#seat(p.seat)
        if (seat !== undefined) seat.voted = true
        break
      }

      case T11_EVENTS.votesRevealed: {
        const p = event.payload as VotesRevealedPayload
        const yes = p.votes.filter((v) => v.approve).length
        this.#push(event, `投票揭晓：${yes} 认可 / ${p.votes.length - yes} 反对`)
        break
      }

      case T11_EVENTS.proposalPassed:
        this.#push(event, '方案通过')
        break

      case T11_EVENTS.proposalVetoed: {
        const p = event.payload as { reason: string }
        this.#lossPerMark += 1
        this.#push(event, p.reason === 'dissent' ? '方案被否决' : '灾痕未分完，方案否决')
        break
      }

      case T11_EVENTS.graceAdvance:
        this.#push(event, '灾痕未分完，保留分配进入第二协商轮')
        break

      case T11_EVENTS.lossSettled: {
        const p = event.payload as LossSettledPayload
        for (const entry of p.entries) {
          const seat = this.#seat(entry.seat)
          if (seat !== undefined) {
            seat.lifespan = Math.max(0, seat.lifespan - entry.actualLoss)
            seat.burden += entry.actualLoss
          }
        }
        this.#push(event, `结算：单枚 ${p.lossPerMark} 日，${p.entries.length} 人承担`)
        break
      }

      case T11_EVENTS.seatFallen: {
        const { seats } = event.payload as { seats: readonly SeatId[] }
        for (const id of seats) {
          const seat = this.#seat(id)
          if (seat !== undefined) seat.fallen = true
        }
        this.#push(event, `编号 ${seats.join('、')} 失守`)
        break
      }

      // ── 世界内反馈：只呈现现象，不附解释文字 ──
      case T11_EVENTS.participationLampLit: {
        const p = event.payload as { seat: SeatId }
        const seat = this.#seat(p.seat)
        if (seat !== undefined) seat.lampLit = true
        this.#pushWorld(event, `编号 ${p.seat} 座位后方的暗灯亮起`)
        break
      }

      case T11_EVENTS.markCrackClosed: {
        const p = event.payload as { markId: number }
        const mark = this.#mark(p.markId)
        if (mark !== undefined) mark.crackClosed = true
        this.#pushWorld(event, `第 ${p.markId} 枚灾痕表面的裂纹短暂闭合`)
        break
      }

      case T11_EVENTS.ringPulse:
        this.#pushWorld(event, '房间边缘掠过一次环形脉冲')
        break

      case T11_EVENTS.gateRingTurned:
        // 只下发「转了一格」，不显示计数和含义
        this.#pushWorld(event, '出口的门环转动了一格')
        break

      case T11_EVENTS.endgameDeclared: {
        const p = event.payload as { reason: string }
        this.#complete = true
        this.#summary.push(
          {
            allRoundsAllAlive: '六轮打完，全员存活',
            allRoundsWithFallen: '六轮打完，有人失守',
            earlyEnd: '场上只剩两人，关卡提前结束',
          }[p.reason] ?? p.reason,
        )
        this.#push(event, '关卡结束')
        break
      }

      case T11_EVENTS.finalBurdenAwarded: {
        const p = event.payload as {
          rankings: readonly { seat: SeatId; burden: number; rank: number; award: number }[]
        }
        for (const r of p.rankings) {
          const seat = this.#seat(r.seat)
          if (seat !== undefined && r.award > 0) seat.lifespan += r.award
          if (r.award > 0) this.#summary.push(`第 ${r.rank} 名 编号 ${r.seat}（承担值 ${r.burden}）获得 ${r.award} 日`)
        }
        break
      }

      case T11_EVENTS.mandateEvaluated: {
        const p = event.payload as { mandateId: string; achieved: boolean; paid: number; seat: SeatId }
        const seat = this.#seat(p.seat)
        if (seat !== undefined && p.paid > 0) seat.lifespan += p.paid
        const definition = MANDATE_BY_ID.get(p.mandateId)
        this.#summary.push(
          `密令 ${definition?.title ?? p.mandateId}：${p.achieved ? '达成' : '未达成'}${p.paid > 0 ? `，获得 ${p.paid} 日` : ''}`,
        )
        break
      }

      case T11_EVENTS.perfectClearSettled: {
        const p = event.payload as {
          refunds: readonly { seat: SeatId; ticket: number; markLoss: number; bonus: number }[]
        }
        for (const refund of p.refunds) {
          const seat = this.#seat(refund.seat)
          if (seat !== undefined) seat.lifespan += refund.ticket + refund.markLoss + refund.bonus
        }
        this.#summary.push('完美通关：门票与灾痕损失全额返还')
        break
      }

      case T11_EVENTS.publicSpeech: {
        const p = event.payload as { seat: SeatId; text: string }
        this.#feed.push({ seq: event.seq, text: p.text, kind: 'chat', speaker: p.seat })
        break
      }

      case T11_EVENTS.privateMessage: {
        const p = event.payload as { from: SeatId; text: string }
        this.#feed.push({ seq: event.seq, text: `（私聊）${p.text}`, kind: 'chat', speaker: p.from })
        break
      }
    }
  }

  render(viewerSeat: SeatId | null): ViewModel {
    const active = this.#actionOrder[this.#actionCursor] ?? null

    const seats: readonly SeatView[] = this.#seats.map((s) => ({
      id: s.id,
      label: `编号 ${s.id}`,
      primaryValue: s.lifespan,
      primaryLabel: '余命',
      secondaryValue: s.burden,
      secondaryLabel: '承担值',
      fallen: s.fallen,
      active: s.id === active,
      badges: [
        ...(s.committed ? ['已承诺认可'] : []),
        ...(s.ready ? ['已就绪'] : []),
        ...(s.voted ? ['已锁定投票'] : []),
        ...(this.#marks.filter((m) => m.holder === s.id).length > 0
          ? [`持有 ${this.#marks.filter((m) => m.holder === s.id).length} 枚`]
          : []),
      ],
      lampLit: s.lampLit,
    }))

    const publicItems: readonly PublicItemView[] = this.#marks.map((m) => ({
      id: m.id,
      label: m.holder === null ? `灾痕 ${m.id}（无人承担）` : `灾痕 ${m.id} → 编号 ${m.holder}`,
      holder: m.holder,
      highlighted: m.crackClosed,
    }))

    return {
      templateId: 't11',
      phaseId: this.#phase,
      phaseLabel: PHASE_LABEL[this.#phase] ?? this.#phase,
      roundLabel:
        this.#levelRound === 0
          ? '准备中'
          : `第 ${this.#levelRound} 轮 · 第 ${this.#negotiationRound} 协商轮 · 单枚 ${this.#lossPerMark} 日`,
      seats,
      publicItems,
      publicItemsLabel: '灾痕',
      actions: this.#actionsFor(viewerSeat),
      feed: this.#feed.slice(-60),
      secret: this.#secretFor(viewerSeat),
      complete: this.#complete,
      summary: this.#summary,
    }
  }

  #actionsFor(viewer: SeatId | null): readonly ActionOption[] {
    if (viewer === null) return []
    const me = this.#seat(viewer)
    if (me === undefined || me.fallen) return []

    const options: ActionOption[] = []
    const held = this.#marks.filter((m) => m.holder === viewer).length
    const canTakeMore = held < this.#maxMarksPerSeat

    if (this.#phase === T11_PHASES.sequentialAction) {
      // 待回应期间只有被申请者能动
      if (this.#pendingHolder !== null) {
        if (this.#pendingHolder === viewer) {
          options.push(
            {
              commandType: T11_COMMANDS.respondTransfer,
              label: `同意让出第 ${this.#pendingMarkId ?? 0} 枚`,
              payload: { accepted: true },
              enabled: true,
            },
            {
              commandType: T11_COMMANDS.respondTransfer,
              label: '拒绝',
              payload: { accepted: false },
              enabled: true,
            },
          )
        }
        return options
      }

      const myTurn = this.#actionOrder[this.#actionCursor] === viewer
      for (const mark of this.#marks) {
        if (mark.holder === null) {
          options.push({
            commandType: T11_COMMANDS.assumeMark,
            label: `承担灾痕 ${mark.id}`,
            payload: { markId: mark.id },
            enabled: myTurn && canTakeMore,
            ...(myTurn ? (canTakeMore ? {} : { disabledReason: '已持有 2 枚' }) : { disabledReason: '还没轮到你' }),
          })
        } else if (mark.holder !== viewer) {
          options.push({
            commandType: T11_COMMANDS.requestTransfer,
            label: `申请接手编号 ${mark.holder} 的灾痕 ${mark.id}`,
            payload: { markId: mark.id },
            enabled: myTurn && canTakeMore,
            ...(myTurn ? (canTakeMore ? {} : { disabledReason: '已持有 2 枚' }) : { disabledReason: '还没轮到你' }),
          })
        }
      }
      options.push({
        commandType: T11_COMMANDS.pass,
        label: '不选',
        payload: {},
        enabled: myTurn,
        ...(myTurn ? {} : { disabledReason: '还没轮到你' }),
      })
      return options
    }

    if (this.#phase === T11_PHASES.freeExchange) {
      options.push({
        commandType: T11_COMMANDS.commitApproval,
        label: '公开承诺认可',
        payload: {},
        enabled: !me.committed,
        ...(me.committed ? { disabledReason: '本协商轮已承诺过，且不可撤回' } : {}),
      })
      options.push({
        commandType: T11_COMMANDS.ready,
        label: '就绪',
        payload: {},
        enabled: !me.ready,
        ...(me.ready ? { disabledReason: '已就绪' } : {}),
      })
      return options
    }

    if (this.#phase === T11_PHASES.approvalVote) {
      options.push(
        {
          commandType: T11_COMMANDS.lockVote,
          label: '认可',
          payload: { approve: true },
          enabled: !me.voted,
          ...(me.voted ? { disabledReason: '已锁定' } : {}),
        },
        {
          commandType: T11_COMMANDS.lockVote,
          label: '反对',
          payload: { approve: false },
          enabled: !me.voted,
          ...(me.voted ? { disabledReason: '已锁定' } : {}),
        },
      )
    }
    return options
  }

  #secretFor(viewer: SeatId | null): ViewModel['secret'] {
    if (viewer === null || this.#myMandate === null) return null
    const definition = MANDATE_BY_ID.get(this.#myMandate.mandateId)
    if (definition === undefined) return null
    const target = this.#myMandate.target
    return {
      title: `密令 ${definition.title}`,
      lines: [
        definition.goal.replace('X', target === null ? 'X' : `编号 ${target}`),
        definition.condition.replace('X', target === null ? 'X' : `编号 ${target}`),
        `难度：${{ low: '低', mid: '中', high: '高' }[definition.difficulty]}`,
      ],
    }
  }

  #seat(id: SeatId): SeatRecord | undefined {
    return this.#seats.find((s) => s.id === id)
  }

  #mark(id: number): MarkRecord | undefined {
    return this.#marks.find((m) => m.id === id)
  }

  #push(event: EventRecord, text: string): void {
    this.#feed.push({ seq: event.seq, text, kind: 'rule' })
  }

  #pushWorld(event: EventRecord, text: string): void {
    this.#feed.push({ seq: event.seq, text, kind: 'worldFeedback' })
  }
}
