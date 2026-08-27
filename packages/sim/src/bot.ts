/**
 * T-11 机器人策略。
 *
 * 两个用途共用同一份实现：批量模拟（docs/15 §10）与真人局补位。
 * 策略必须由种子完全决定——否则批量模拟的经济数字不可复现，跑出来的分布没有意义。
 *
 * 这不是「打得好」的 AI，是一个**能把规则空间走遍**的采样器：
 * 它会承担、会申请转移、会拒绝、会公开承诺后反悔、会投反对票，
 * 因为 docs/12 的验收项要看这些行为的分布，而不是看胜负。
 */

import { SeededRandom, command, type Command, type SeatId } from '@terminus/kernel'
import {
  T11_COMMANDS,
  T11_PHASES,
  marksHeldBy,
  unallocatedMarks,
  type T11State,
} from '@terminus/templates'
import type { KernelState, DeepReadonly } from '@terminus/kernel'

/** 各行为的百分比倾向。全部是整数，参与判定时按百分比整数比较。 */
export interface BotProfile {
  /** 轮到自己且有未分配灾痕时，选择承担的概率。 */
  readonly assumeWhenUnallocated: number
  /** 已分配完时，向他人申请转移的概率。 */
  readonly requestTransferWhenAllocated: number
  /** 被申请时同意的概率。 */
  readonly acceptTransfer: number
  /** 自由交流时公开承诺认可的概率。 */
  readonly commitApproval: number
  /** 投认可票的概率。 */
  readonly approve: number
  /** 已公开承诺后仍投反对的概率——制造言行差异，供 M-07 与推断管线取样。 */
  readonly betrayCommitment: number
}

export const DEFAULT_BOT_PROFILE: BotProfile = {
  assumeWhenUnallocated: 70,
  requestTransferWhenAllocated: 25,
  acceptTransfer: 45,
  commitApproval: 50,
  approve: 85,
  betrayCommitment: 12,
}

export class T11Bot {
  readonly seat: SeatId
  readonly #random: SeededRandom
  readonly #profile: BotProfile

  constructor(seat: SeatId, seed: number, profile: BotProfile = DEFAULT_BOT_PROFILE) {
    this.seat = seat
    // 每个座位一条独立的随机流，避免座位之间因共用流而产生相关性
    this.#random = new SeededRandom(seed * 1_000_003 + seat)
    this.#profile = profile
  }

  #chance(percent: number): boolean {
    return this.#random.rollPercent(percent).success
  }

  /**
   * 给出本座位此刻要提交的命令；返回 null 表示现在没有自己该做的事。
   * 只读状态，不改状态——决策错了也只会被内核校验拒绝，不会破坏对局。
   */
  decide(state: DeepReadonly<KernelState<T11State>>): Command | null {
    const seat = state.seats.find((s) => s.id === this.seat)
    if (seat === undefined || seat.fallen) return null

    const t = state.template

    switch (state.phase) {
      case T11_PHASES.sequentialAction: {
        // 待回应优先：只有被申请者能回应，其余人此刻无事可做
        if (t.pending !== null) {
          if (t.pending.holder !== this.seat) return null
          return command(T11_COMMANDS.respondTransfer, this.seat, {
            accepted: this.#chance(this.#profile.acceptTransfer),
          })
        }
        if (t.actionOrder[t.actionCursor] !== this.seat) return null
        return this.#actInSequence(state)
      }

      case T11_PHASES.freeExchange: {
        if (t.ready.includes(this.seat)) return null
        if (!t.commitments.includes(this.seat) && this.#chance(this.#profile.commitApproval)) {
          return command(T11_COMMANDS.commitApproval, this.seat, {})
        }
        return command(T11_COMMANDS.ready, this.seat, {})
      }

      case T11_PHASES.approvalVote: {
        if (t.votes.some((v) => v.seat === this.seat)) return null
        return command(T11_COMMANDS.lockVote, this.seat, { approve: this.#decideVote(state) })
      }

      default:
        return null
    }
  }

  #actInSequence(state: DeepReadonly<KernelState<T11State>>): Command | null {
    const t = state.template
    const held = marksHeldBy(t.marks, this.seat).length
    const canTakeMore = held < t.params.maxMarksPerSeat
    const free = unallocatedMarks(t.marks)

    if (free.length > 0 && canTakeMore && this.#chance(this.#profile.assumeWhenUnallocated)) {
      const mark = this.#random.pick(free)
      return command(T11_COMMANDS.assumeMark, this.seat, { markId: mark.id })
    }

    if (free.length === 0 && canTakeMore) {
      const others = t.marks.filter((m) => m.holder !== null && m.holder !== this.seat)
      if (others.length > 0 && this.#chance(this.#profile.requestTransferWhenAllocated)) {
        const mark = this.#random.pick(others)
        return command(T11_COMMANDS.requestTransfer, this.seat, { markId: mark.id })
      }
    }

    return command(T11_COMMANDS.pass, this.seat, {})
  }

  /**
   * 投票倾向。
   *
   * 未分配完时压低认可率——否则机器人会一路认可，
   * 「未认领完也触发升级后玩家是否仍会集体拖延」这条验收项永远取不到样本。
   */
  #decideVote(state: DeepReadonly<KernelState<T11State>>): boolean {
    const t = state.template
    if (unallocatedMarks(t.marks).length > 0) return this.#chance(30)
    if (t.commitments.includes(this.seat)) {
      return !this.#chance(this.#profile.betrayCommitment)
    }
    return this.#chance(this.#profile.approve)
  }
}
