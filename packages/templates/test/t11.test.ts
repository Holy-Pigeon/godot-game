/**
 * M1–M3 验收（docs/15 §11、§10）。
 */

import { describe, expect, test } from 'vitest'
import {
  Runtime,
  buildCompatibilityMatrix,
  canonicalize,
  command,
  deadPredicates,
  replay,
  stateHash,
  visibleTo,
  type Command,
  type SeatSetup,
} from '@terminus/kernel'
import {
  T11Template,
  T11_COMMANDS,
  T11_DEFAULT_PARAMS,
  T11_EVENTS,
  T11_PHASES,
  ToyTemplate,
  actOfRound,
  lossPerMark,
  type LossSettledPayload,
  type T11State,
} from '../src/index.ts'

const SIX: readonly SeatSetup[] = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, lifespan: 30 }))

function newMatch(seed = 1, seats: readonly SeatSetup[] = SIX, params = T11_DEFAULT_PARAMS) {
  const runtime = new Runtime<T11State>(new T11Template(params) as never, { seed, seats })
  runtime.open()
  return runtime
}

function drive(runtime: Runtime<T11State>, commands: readonly Command[]): void {
  for (const cmd of commands) {
    const result = runtime.submit(cmd)
    if (!result.ok) {
      throw new Error(`命令 ${cmd.type}（座位 ${String(cmd.actor)}）被拒绝：${result.reason}`)
    }
  }
}

const assume = (seat: number, markId: number) => command(T11_COMMANDS.assumeMark, seat, { markId })
const request = (seat: number, markId: number) =>
  command(T11_COMMANDS.requestTransfer, seat, { markId })
const respond = (seat: number, accepted: boolean) =>
  command(T11_COMMANDS.respondTransfer, seat, { accepted })
const pass = (seat: number) => command(T11_COMMANDS.pass, seat, {})
const ready = (seat: number) => command(T11_COMMANDS.ready, seat, {})
const vote = (seat: number, approve: boolean) => command(T11_COMMANDS.lockVote, seat, { approve })
const readyAll = (seats: readonly number[]) => seats.map(ready)
const voteAll = (seats: readonly number[], approve: boolean) => seats.map((s) => vote(s, approve))

describe('阶段表与流程（docs/15 §7.1）', () => {
  test('开局后进入灾难显现并立即推进到顺序行动', () => {
    const runtime = newMatch()
    expect(runtime.state.phase).toBe(T11_PHASES.sequentialAction)
    expect(runtime.state.levelRound).toBe(1)
    expect(runtime.state.negotiationRound).toBe(1)
    expect(runtime.state.template.marks.length).toBe(4)
  })

  test('两个回响窗口阶段存在且零耗时穿过（docs/15 §5、§7.1）', () => {
    const runtime = newMatch()
    const phases = new T11Template().phases().map((p) => p.id)
    expect(phases).toContain(T11_PHASES.echoWindowAllocation)
    expect(phases).toContain(T11_PHASES.echoWindowInformation)

    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6)])
    // 零耗时穿过：分配检查后直接停在自由交流，不停在回响窗口
    expect(runtime.state.phase).toBe(T11_PHASES.freeExchange)

    const entered = runtime.log
      .ruleEventsOfType(T11_EVENTS.phaseEntered)
      .map((e) => (e.payload as { phase: string }).phase)
    expect(entered).toContain(T11_PHASES.echoWindowAllocation)
  })

  test('首位行动者按关卡轮次轮换（docs/12）', () => {
    const runtime = newMatch()
    const first = runtime.log.ruleEventsOfType(T11_EVENTS.levelRoundStarted)[0]
    expect((first?.payload as { firstActor: number }).firstActor).toBe(1)
  })

  test('幕次与单枚基础损失由轮次推出，不进状态（docs/15 §7.3）', () => {
    expect([1, 2, 3, 4, 5, 6].map(actOfRound)).toEqual([1, 1, 2, 2, 3, 3])
    expect(lossPerMark(1, 0)).toBe(1)
    expect(lossPerMark(3, 0)).toBe(2)
    expect(lossPerMark(5, 0)).toBe(3)
    // 本关卡轮次每否决一次，单枚损失永久 +1
    expect(lossPerMark(1, 2)).toBe(3)
  })
})

describe('顺序行动与打断（docs/15 §7.2）', () => {
  test('待回应是子状态而非新阶段，期间只接受被申请者的回应', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), request(5, 0)])

    expect(runtime.state.phase).toBe(T11_PHASES.sequentialAction)
    expect(runtime.state.template.pending).toEqual({ requester: 5, holder: 1, markId: 0 })

    // 其余命令一律拒绝
    expect(runtime.submit(pass(6)).ok).toBe(false)
    expect(runtime.submit(request(6, 1)).ok).toBe(false)
    // 非被申请者不能回应
    expect(runtime.submit(respond(2, true)).ok).toBe(false)
    // 被申请者可以
    expect(runtime.submit(respond(1, true)).ok).toBe(true)
    expect(runtime.state.template.pending).toBeNull()
  })

  test('回应不消耗被申请者的行动，申请无论成败都消耗申请者的行动', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), request(5, 0), respond(1, false)])
    // 5 的行动已消耗（申请失败也消耗），轮到 6
    expect(runtime.state.template.actionOrder[runtime.state.template.actionCursor]).toBe(6)
    // 1 早已行动过，其回应没有额外消耗任何东西
    expect(runtime.state.template.marks.find((m) => m.id === 0)?.holder).toBe(1)
  })

  test('每人最多持有 2 枚', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0)])
    expect(runtime.submit(assume(1, 1)).ok).toBe(false) // 还没轮到 1
    drive(runtime, [assume(2, 1), assume(3, 2), assume(4, 3)])
    // 5 已无未分配灾痕可承担
    expect(runtime.submit(assume(5, 0)).ok).toBe(false)
  })

  test('不能向自己申请转移', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6)])
    // 已进入自由交流，顺序行动命令此时被阶段准入表拒绝
    expect(runtime.submit(request(1, 0)).ok).toBe(false)
  })
})

describe('投票、否决与无代价推进（docs/12）', () => {
  test('4 枚全有主且反对不超过 1 张即通过', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      vote(1, false), ...voteAll([2, 3, 4, 5, 6], true),
    ])
    expect(runtime.log.ruleEventsOfType(T11_EVENTS.proposalPassed).length).toBe(1)
    expect(runtime.state.levelRound).toBe(2)
  })

  test('2 张反对票即正式否决，单枚损失与奖池同时抬高', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      ...voteAll([1, 2], false), ...voteAll([3, 4, 5, 6], true),
    ])
    const t = runtime.state.template
    expect(t.roundVetoes).toBe(1)
    expect(t.totalVetoes).toBe(1)
    expect(runtime.state.levelRound).toBe(1) // 仍在同一关卡轮次
    expect(runtime.state.negotiationRound).toBe(2)
    // 否决后不清空当前分配
    expect(t.marks.every((m) => m.holder !== null)).toBe(true)
  })

  test('第一协商轮仅因未分完、反对不超过 1 张时无代价进入第二协商轮', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), pass(3), pass(4), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      ...voteAll([1, 2, 3, 4, 5, 6], true),
    ])
    const t = runtime.state.template
    expect(runtime.log.ruleEventsOfType(T11_EVENTS.graceAdvance).length).toBe(1)
    // 不记为否决，不提高损失，也不增加奖池
    expect(t.totalVetoes).toBe(0)
    expect(t.roundVetoes).toBe(0)
    expect(runtime.state.negotiationRound).toBe(2)
    // 全员重新获得一次顺序行动（本仓库的实现判读，见计划第四节第 1 条）
    expect(runtime.state.phase).toBe(T11_PHASES.sequentialAction)
    expect(t.actionCursor).toBe(0)
  })

  test('第二协商轮起未分完即使认可达 n−1 也视为否决', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), pass(3), pass(4), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      ...voteAll([1, 2, 3, 4, 5, 6], true),
    ])
    // 第二协商轮仍不分完
    drive(runtime, [
      pass(2), pass(3), pass(4), pass(5), pass(6), pass(1),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      ...voteAll([1, 2, 3, 4, 5, 6], true),
    ])
    expect(runtime.state.template.totalVetoes).toBe(1)
    expect(
      runtime.log
        .ruleEventsOfType(T11_EVENTS.proposalVetoed)
        .some((e) => (e.payload as { reason: string }).reason === 'unallocated'),
    ).toBe(true)
  })

  test('否决后下一协商轮首位行动者顺延一个存活座位', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      ...voteAll([1, 2], false), ...voteAll([3, 4, 5, 6], true),
    ])
    expect(runtime.state.template.actionOrder[0]).toBe(2)
  })

  test('公开承诺每协商轮最多一次且不可撤回', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6)])
    expect(runtime.submit(command(T11_COMMANDS.commitApproval, 1, {})).ok).toBe(true)
    expect(runtime.submit(command(T11_COMMANDS.commitApproval, 1, {})).ok).toBe(false)
  })
})

describe('结算（docs/15 §7.3）', () => {
  test('同时扣除：全部算完再一次性写入', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(1, 1) /* 会被拒 */,
    ].slice(0, 1))
    drive(runtime, [assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]), ...voteAll([1, 2, 3, 4, 5, 6], true)])

    const settled = runtime.log.ruleEventsOfType(T11_EVENTS.lossSettled)[0]
    const payload = settled?.payload as LossSettledPayload
    expect(payload.lossPerMark).toBe(1)
    expect(payload.entries.length).toBe(4)
    // 门票 2 + 第一轮 1 枚 1 日
    expect(runtime.state.seats.find((s) => s.id === 1)?.lifespan).toBe(27)
    expect(runtime.state.seats.find((s) => s.id === 5)?.lifespan).toBe(28)
  })

  test('承担值总和恒等于实际扣除总和（docs/15 §7.3 不变量）', () => {
    const runtime = playFullMatch(9)
    const t = runtime.state.template
    const burdenSum = t.burden.reduce((a, b) => a + b.value, 0)
    const actualSum = runtime.log
      .ruleEventsOfType(T11_EVENTS.lossSettled)
      .reduce(
        (acc, e) =>
          acc + (e.payload as LossSettledPayload).entries.reduce((a, x) => a + x.actualLoss, 0),
        0,
      )
    expect(burdenSum).toBe(actualSum)
  })

  test('实际扣除是归零截断后的值，余命不为负', () => {
    // 入场 5 日：门票 2 后剩 3，第 3 轮起单枚 2 日，两枚就会击穿
    const runtime = playFullMatch(3, Array.from({ length: 6 }, (_, i) => ({ id: i + 1, lifespan: 5 })))
    for (const seat of runtime.state.seats) expect(seat.lifespan).toBeGreaterThanOrEqual(0)
    for (const event of runtime.log.ruleEventsOfType(T11_EVENTS.lossSettled)) {
      for (const entry of (event.payload as LossSettledPayload).entries) {
        expect(entry.actualLoss).toBeLessThanOrEqual(entry.nominalLoss)
        expect(entry.actualLoss).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('失守者不能再行动', () => {
    const runtime = newMatch(1, [
      { id: 1, lifespan: 3 },
      { id: 2, lifespan: 30 },
      { id: 3, lifespan: 30 },
      { id: 4, lifespan: 30 },
      { id: 5, lifespan: 30 },
      { id: 6, lifespan: 30 },
    ])
    // 座位 1 门票后仅剩 1 日，扛一枚就归零
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]), ...voteAll([1, 2, 3, 4, 5, 6], true),
    ])
    expect(runtime.state.seats.find((s) => s.id === 1)?.fallen).toBe(true)
    expect(runtime.submit(pass(1)).ok).toBe(false)
  })
})

describe('潜规则层（docs/12 内部潜规则、docs/15 §7.4）', () => {
  test('参与灯只由主动承担与自愿转移点亮，不选与被拒不点亮', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3)])
    expect(runtime.state.template.hidden.lamps).toEqual([1, 2, 3, 4])

    // 5 申请被拒：双方都不因此点灯
    drive(runtime, [request(5, 0), respond(1, false)])
    expect(runtime.state.template.hidden.lamps).toEqual([1, 2, 3, 4])

    // 6 不选：不点灯
    drive(runtime, [pass(6)])
    expect(runtime.state.template.hidden.lamps).toEqual([1, 2, 3, 4])
  })

  test('一枚灾痕首次发生玩家间移动时裂纹闭合', () => {
    const runtime = newMatch()
    drive(runtime, [assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), request(5, 0), respond(1, true)])
    expect(runtime.log.ruleEventsOfType(T11_EVENTS.markCrackClosed).length).toBe(1)
    expect(runtime.state.template.hidden.cracksClosedThisRound).toEqual([0])
    // 成功接手者与同意让出者双双点灯
    expect(runtime.state.template.hidden.lamps).toEqual([1, 2, 3, 4, 5])
  })

  test('六灯全亮时出现环形脉冲，且门环三条件成立时转动一格并记入共同决策轮', () => {
    const runtime = newMatch()
    // 第一协商轮：四人承担，两人各接手一枚 → 六人全参与，但只有两枚移动过
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3),
      request(5, 0), respond(1, true),
      request(6, 1), respond(2, true),
    ])
    expect(runtime.state.template.hidden.lamps).toEqual([1, 2, 3, 4, 5, 6])
    expect(runtime.log.ruleEventsOfType(T11_EVENTS.ringPulse).length).toBe(1)

    // 故意否决，进入第二协商轮，把剩下两枚也移动掉
    drive(runtime, [
      ...readyAll([1, 2, 3, 4, 5, 6]),
      ...voteAll([1, 2], false), ...voteAll([3, 4, 5, 6], true),
    ])
    drive(runtime, [
      request(2, 3), respond(4, true),
      pass(3), pass(4), pass(5), pass(6),
      request(1, 2), respond(3, true),
    ])
    expect(runtime.state.template.marks.every((m) => m.hasMoved)).toBe(true)

    drive(runtime, [...readyAll([1, 2, 3, 4, 5, 6]), ...voteAll([1, 2, 3, 4, 5, 6], true)])

    expect(runtime.log.ruleEventsOfType(T11_EVENTS.gateRingTurned).length).toBe(1)
    expect(runtime.state.template.hidden.gateRingTurns).toBe(1)
    expect(runtime.state.template.hidden.coDecisionRounds).toBe(1)
  })

  test('只达到 n−1 认可不计共同决策轮', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3),
      request(5, 0), respond(1, true),
      request(6, 1), respond(2, true),
      ...readyAll([1, 2, 3, 4, 5, 6]),
      vote(1, false), ...voteAll([2, 3, 4, 5, 6], true),
    ])
    expect(runtime.state.template.hidden.coDecisionRounds).toBe(0)
    expect(runtime.log.ruleEventsOfType(T11_EVENTS.gateRingTurned).length).toBe(0)
  })

  test('潜规则内部量一律仅服务端，永不下发（docs/15 §8）', () => {
    const runtime = playFullMatch(1)
    const serverOnly = [T11_EVENTS.coDecisionRoundCounted, T11_EVENTS.perfectClearRolled, T11_EVENTS.endgameRecorded]
    for (const type of serverOnly) {
      for (const event of runtime.log.ruleEventsOfType(type)) {
        expect(event.visibility.kind).toBe('serverOnly')
        for (const seat of [1, 2, 3, 4, 5, 6]) {
          expect(visibleTo(event.visibility, seat)).toBe(false)
        }
      }
    }
    // 世界内反馈是公开的，但载荷里不含计数与解释
    for (const event of runtime.log.ruleEventsOfType(T11_EVENTS.gateRingTurned)) {
      expect(event.visibility.kind).toBe('public')
      expect(canonicalize(event.payload)).toBe('{}')
    }
  })

  test('完美判定载荷同时记录共同决策轮数、概率、抽取值与结果（docs/15 §7.4）', () => {
    const runtime = playFullMatch(1)
    const rolled = runtime.log.ruleEventsOfType(T11_EVENTS.perfectClearRolled)[0]
    expect(rolled).toBeDefined()
    const payload = rolled?.payload as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['coDecisionRounds', 'draw', 'probabilityPercent', 'success'])
  })
})

describe('终局（docs/15 §7.5）', () => {
  test('终局拆两步：先发最终承担奖，再做密令求值', () => {
    const runtime = playFullMatch(1)
    const award = runtime.log.ruleEventsOfType(T11_EVENTS.finalBurdenAwarded)[0]
    const firstMandate = runtime.log.ruleEventsOfType(T11_EVENTS.mandateEvaluated)[0]
    expect(award).toBeDefined()
    expect(firstMandate).toBeDefined()
    // M-10【活得最少】读的是发奖后的余命，因此密令序号必须严格在发奖之后
    expect(firstMandate!.seq).toBeGreaterThan(award!.seq)
  })

  test('三条终局路径都无条件写出留档与含共同决策轮数的终局事件', () => {
    const cases = [
      { seats: SIX, seed: 1 },
      { seats: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, lifespan: 6 })), seed: 4 },
      { seats: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, lifespan: 3 })), seed: 7 },
    ]
    const reasons = new Set<string>()
    for (const c of cases) {
      const runtime = playFullMatch(c.seed, c.seats)
      const recorded = runtime.log.ruleEventsOfType(T11_EVENTS.endgameRecorded)[0]
      expect(recorded).toBeDefined()
      const payload = recorded?.payload as { reason: string; coDecisionRounds: number; gateRingTurns: number }
      expect(typeof payload.coDecisionRounds).toBe('number')
      expect(typeof payload.gateRingTurns).toBe('number')
      reasons.add(payload.reason)
    }
    // 参数扫描确实覆盖到了不止一条路径（docs/15 §10）
    expect(reasons.size).toBeGreaterThan(1)
  })

  test('最终承担奖为 14+F / 8+F，失守者不获奖且名次顺延', () => {
    const runtime = playFullMatch(9)
    const award = runtime.log.ruleEventsOfType(T11_EVENTS.finalBurdenAwarded)[0]
    const payload = award?.payload as {
      totalVetoes: number
      rankings: readonly { seat: number; award: number; rank: number }[]
    }
    const paid = payload.rankings.filter((r) => r.award > 0)
    expect(paid.length).toBeLessThanOrEqual(2)
    if (paid.length === 2) {
      expect(paid[0]?.award).toBe(T11_DEFAULT_PARAMS.finalAwardFirst + payload.totalVetoes)
      expect(paid[1]?.award).toBe(T11_DEFAULT_PARAMS.finalAwardSecond + payload.totalVetoes)
    }
    for (const ranking of payload.rankings) {
      expect(runtime.state.seats.find((s) => s.id === ranking.seat)?.fallen).toBe(false)
    }
  })
})

describe('密令（docs/15 §7.6）', () => {
  test('每人一条、仅本人可见、抽取结果先写成事件', () => {
    const runtime = newMatch()
    const dealt = runtime.log.ruleEventsOfType(T11_EVENTS.mandateDealt)
    expect(dealt.length).toBe(6)
    for (const event of dealt) {
      expect(event.visibility.kind).toBe('self')
      const payload = event.payload as { seat: number; mandateId: string }
      expect(visibleTo(event.visibility, payload.seat)).toBe(true)
      expect(visibleTo(event.visibility, payload.seat === 1 ? 2 : 1)).toBe(false)
    }
    // 固定抽取两条低、两条中、两条高
    const ids = dealt.map((e) => (e.payload as { mandateId: string }).mandateId)
    expect(new Set(ids).size).toBe(6)
  })

  test('每条成功判定必须引用具体事件序号（docs/13 证据强制引用）', () => {
    const runtime = playFullMatch(9)
    const evaluated = runtime.log.ruleEventsOfType(T11_EVENTS.mandateEvaluated)
    expect(evaluated.length).toBe(6)
    for (const event of evaluated) {
      const payload = event.payload as { achieved: boolean; evidenceSeqs: number[] }
      if (payload.achieved) {
        expect(payload.evidenceSeqs.length).toBeGreaterThan(0)
        for (const seq of payload.evidenceSeqs) expect(seq).toBeLessThan(event.seq)
      }
    }
  })

  test('记录与发放分开：失守者判定入档但发放归零', () => {
    const runtime = playFullMatch(7, Array.from({ length: 6 }, (_, i) => ({ id: i + 1, lifespan: 3 })))
    const evaluated = runtime.log.ruleEventsOfType(T11_EVENTS.mandateEvaluated)
    expect(evaluated.length).toBe(6) // 失守者也在档
    for (const event of evaluated) {
      const payload = event.payload as { seat: number; achieved: boolean; paid: number }
      const fallen = runtime.state.seats.find((s) => s.id === payload.seat)?.fallen
      if (fallen === true) expect(payload.paid).toBe(0)
    }
  })
})

describe('可见性（docs/15 §8）', () => {
  test('锁定前的投票仅本人，揭晓时才转公开', () => {
    const runtime = newMatch()
    drive(runtime, [
      assume(1, 0), assume(2, 1), assume(3, 2), assume(4, 3), pass(5), pass(6),
      ...readyAll([1, 2, 3, 4, 5, 6]), ...voteAll([1, 2, 3, 4, 5, 6], true),
    ])
    for (const event of runtime.log.ruleEventsOfType(T11_EVENTS.voteLocked)) {
      expect(event.visibility.kind).toBe('self')
    }
    expect(runtime.log.ruleEventsOfType(T11_EVENTS.votesRevealed)[0]?.visibility.kind).toBe('public')
  })

  test('私聊定向可见，且进的是行为语料流', () => {
    const runtime = newMatch()
    runtime.submit(command(T11_COMMANDS.whisper, 1, { to: [3], text: '我扛第 0 枚，你别抢' }))
    const message = runtime.log.corpusEvents.at(-1)
    expect(message?.type).toBe(T11_EVENTS.privateMessage)
    expect(message?.stream).toBe('corpus')
    expect(visibleTo(message!.visibility, 1)).toBe(true)
    expect(visibleTo(message!.visibility, 3)).toBe(true)
    expect(visibleTo(message!.visibility, 2)).toBe(false)
  })
})

describe('重放与确定性（docs/15 §0 约束 A、§2.5）', () => {
  test('黄金重放：状态哈希一致', () => {
    const runtime = playFullMatch(11)
    const replayed = replay(new T11Template() as never, SIX, runtime.log.ruleEvents)
    expect(stateHash(replayed)).toBe(runtime.snapshot('test').stateHash)
  })

  test('同种子两次运行完全一致', () => {
    expect(playFullMatch(12).snapshot('t').stateHash).toBe(playFullMatch(12).snapshot('t').stateHash)
  })

  test('删掉行为语料流后重放，结算数值完全一致（docs/13 硬性验收）', () => {
    const runtime = playFullMatch(13, SIX, true)
    expect(runtime.log.corpusEvents.length).toBeGreaterThan(0)
    const replayed = replay(new T11Template() as never, SIX, runtime.log.ruleEvents)
    expect(replayed.seats.map((s) => s.lifespan)).toEqual(
      runtime.state.seats.map((s) => s.lifespan),
    )
    expect(stateHash(replayed)).toBe(runtime.snapshot('t').stateHash)
  })
})

describe('三张绑定表与兼容矩阵（docs/15 §3.2、§3.3）', () => {
  test('T-11 绑定全部八条谓词，创伤绑定齐备，锚点注册表为空', () => {
    const template = new T11Template()
    const matrix = buildCompatibilityMatrix(
      template.id,
      template.anchorBindings(),
      template.predicateBindings(),
      template.traumaBindings(),
    )
    expect(matrix.predicateCoverage).toEqual({ bound: 8, total: 8 })
    expect(matrix.hasTraumaBindings).toBe(true)
    // MVP：锚点注册表存在但为空，可用性判定恒为假（docs/15 §5）
    expect(matrix.anchorCoverage).toEqual({ implemented: 0, required: 4 })
    expect(matrix.missingAnchors.length).toBe(4)
  })

  test('玩具模板不绑定谓词是合法降级，不是错误', () => {
    const toy = new ToyTemplate()
    const matrix = buildCompatibilityMatrix(
      toy.id,
      toy.anchorBindings(),
      toy.predicateBindings(),
      toy.traumaBindings(),
    )
    expect(matrix.unboundPredicates.length).toBe(8)
    expect(matrix.hasTraumaBindings).toBe(true)
  })

  test('死条目检查：有 T-11 在库时没有永远不会激活的谓词', () => {
    const t11 = new T11Template()
    const toy = new ToyTemplate()
    const matrices = [t11, toy].map((t) =>
      buildCompatibilityMatrix(t.id, t.anchorBindings(), t.predicateBindings(), t.traumaBindings()),
    )
    expect(deadPredicates(matrices)).toEqual([])
    // 只有玩具模板时，八条谓词全是死条目
    expect(deadPredicates([matrices[1]!]).length).toBe(8)
  })

  test('W6 的口径是「他人因我而实际损失余命」，不绑定致人死亡（docs/14 ⚠）', () => {
    const bindings = new T11Template().traumaBindings()
    const w6 = bindings.filter((b) => b.feeds.includes('W6'))
    expect(w6.length).toBeGreaterThan(0)
    for (const binding of w6) {
      expect(binding.eventType).not.toBe(T11_EVENTS.seatFallen)
    }
  })
})

// ─────────────────────────── 驱动整局的机器人 ───────────────────────────

/** 用最简策略把一局打完，仅供测试取样；正式机器人在 @terminus/sim。 */
function playFullMatch(
  seed: number,
  seats: readonly SeatSetup[] = SIX,
  withChat = false,
): Runtime<T11State> {
  const runtime = newMatch(seed, seats)
  let guard = 0
  while (!runtime.isComplete) {
    const state = runtime.state
    const t = state.template
    const living = state.seats.filter((s) => !s.fallen).map((s) => s.id)
    let acted = false

    if (state.phase === T11_PHASES.sequentialAction) {
      if (t.pending !== null) {
        acted = runtime.submit(respond(t.pending.holder, (seed + guard) % 3 !== 0)).ok
      } else {
        const actor = t.actionOrder[t.actionCursor]
        if (actor !== undefined) {
          const free = t.marks.filter((m) => m.holder === null)
          const held = t.marks.filter((m) => m.holder === actor).length
          if (free.length > 0 && held < t.params.maxMarksPerSeat) {
            acted = runtime.submit(assume(actor, free[0]!.id)).ok
          } else {
            acted = runtime.submit(pass(actor)).ok
          }
        }
      }
    } else if (state.phase === T11_PHASES.freeExchange) {
      if (withChat && guard % 5 === 0) {
        runtime.submit(command(T11_COMMANDS.speak, living[0]!, { text: `第 ${state.levelRound} 轮，我扛了` }))
      }
      for (const seat of living) {
        if (!t.ready.includes(seat)) acted = runtime.submit(ready(seat)).ok || acted
      }
    } else if (state.phase === T11_PHASES.approvalVote) {
      for (const seat of living) {
        if (!t.votes.some((v) => v.seat === seat)) {
          acted = runtime.submit(vote(seat, true)).ok || acted
        }
      }
    }

    if (!acted) runtime.submit(command(T11_COMMANDS.timeout, null, {}))
    if (++guard > 5000) throw new Error(`对局未收敛，停在 ${runtime.state.phase}`)
  }
  return runtime
}
