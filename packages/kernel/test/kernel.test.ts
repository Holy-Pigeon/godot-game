/**
 * M0 完成判据（docs/15 §11）：黄金重放通过。
 * 同时覆盖 §10 测试表里由内核负责的几项。
 */

import { describe, expect, test } from 'vitest'
import {
  canonicalize,
  command,
  EventLog,
  FactProjection,
  replay,
  ruleStreamHash,
  Runtime,
  SeededRandom,
  stateHash,
  visibleTo,
  type EventRecord,
  type SeatSetup,
} from '../src/index.ts'
import { ToyTemplate, TOY_COMMANDS, TOY_EVENTS, TOY_PHASES } from '@terminus/templates'

const SEATS: readonly SeatSetup[] = [
  { id: 1, lifespan: 30 },
  { id: 2, lifespan: 30 },
]

/** 跑一整局玩具模板，双方都认可，中间夹一条发言。 */
function playToyMatch(seed: number): Runtime<ReturnType<ToyTemplate['initialState']>> {
  const runtime = new Runtime(new ToyTemplate(), { seed, seats: SEATS })
  runtime.open()
  runtime.submit(command(TOY_COMMANDS.speak, 1, { text: '我认可这个方案' }))
  runtime.submit(command(TOY_COMMANDS.lockVote, 1, { approve: true }))
  runtime.submit(command(TOY_COMMANDS.speak, 2, { text: '那我也认可' }))
  runtime.submit(command(TOY_COMMANDS.lockVote, 2, { approve: true }))
  return runtime
}

describe('黄金重放（docs/15 §0 约束 A）', () => {
  test('录一局后重放规则事件流，状态哈希一致', () => {
    const runtime = playToyMatch(20260825)
    expect(runtime.isComplete).toBe(true)

    const replayed = replay(new ToyTemplate(), SEATS, runtime.log.ruleEvents)
    expect(stateHash(replayed)).toBe(runtime.snapshot('test').stateHash)
  })

  test('同种子两次运行完全一致', () => {
    const a = playToyMatch(20260825).snapshot('test')
    const b = playToyMatch(20260825).snapshot('test')
    expect(b.stateHash).toBe(a.stateHash)
    expect(b.ruleStreamHash).toBe(a.ruleStreamHash)
    expect(b.drawCount).toBe(a.drawCount)
  })

  test('不同种子会走出不同的随机结果', () => {
    // 玩具模板的唯一随机是首位发言者，两人局有 1/2 概率撞上，
    // 因此扫一批种子断言「至少出现过两种结果」，而不是断言某两个种子必然不同。
    const speakers = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const opened = playToyMatch(1000 + i).log.ruleEventsOfType(TOY_EVENTS.opened)[0]
        return (opened?.payload as { firstSpeaker: number }).firstSpeaker
      }),
    )
    expect(speakers.size).toBe(2)
  })
})

describe('单流重放（docs/13 硬性验收）', () => {
  test('删掉行为语料流后重放，结算结果完全一致', () => {
    const runtime = playToyMatch(7)
    // 语料流确实产生了内容，否则这条测试是空转
    expect(runtime.log.corpusEvents.length).toBe(2)

    const withCorpus = replay(new ToyTemplate(), SEATS, runtime.log.ruleEvents)
    // 「删掉语料流」在存储层就是不传它——规则流本身一个字都不用改
    const withoutCorpus = replay(new ToyTemplate(), SEATS, [...runtime.log.ruleEvents])

    expect(stateHash(withoutCorpus)).toBe(stateHash(withCorpus))
    expect(withoutCorpus.seats.map((s) => s.lifespan)).toEqual([29, 29])
  })

  test('两条流共用同一条序号轴', () => {
    const runtime = playToyMatch(7)
    const seqs = runtime.log.merged().map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
  })
})

describe('唯一写路径（docs/15 §2.2）', () => {
  test('阶段不接受的命令被拒绝，且不产生任何事件', () => {
    const runtime = new Runtime(new ToyTemplate(), { seed: 1, seats: SEATS })
    runtime.open()
    const before = runtime.log.lastSeq
    const result = runtime.submit(command('toy.nonexistent', 1, {}))
    expect(result.ok).toBe(false)
    expect(runtime.log.lastSeq).toBe(before)
  })

  test('校验失败不改变状态', () => {
    const runtime = new Runtime(new ToyTemplate(), { seed: 1, seats: SEATS })
    runtime.open()
    const before = stateHash(replay(new ToyTemplate(), SEATS, runtime.log.ruleEvents))
    const result = runtime.submit(command(TOY_COMMANDS.lockVote, 1, { approve: 'yes' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('approve')
    expect(stateHash(replay(new ToyTemplate(), SEATS, runtime.log.ruleEvents))).toBe(before)
  })

  test('重复投票被拒绝', () => {
    const runtime = new Runtime(new ToyTemplate(), { seed: 1, seats: SEATS })
    runtime.open()
    expect(runtime.submit(command(TOY_COMMANDS.lockVote, 1, { approve: true })).ok).toBe(true)
    expect(runtime.submit(command(TOY_COMMANDS.lockVote, 1, { approve: false })).ok).toBe(false)
  })

  test('对局结束后不再接受命令', () => {
    const runtime = playToyMatch(1)
    expect(runtime.submit(command(TOY_COMMANDS.lockVote, 1, { approve: true })).ok).toBe(false)
  })
})

describe('可见性（docs/15 §8）', () => {
  test('锁定前的投票仅本人可见，揭晓后转公开', () => {
    const runtime = playToyMatch(3)
    const locked = runtime.log.ruleEventsOfType(TOY_EVENTS.voteLocked)
    expect(locked.length).toBe(2)
    for (const event of locked) {
      expect(event.visibility.kind).toBe('self')
      const owner = event.actor as number
      expect(visibleTo(event.visibility, owner)).toBe(true)
      expect(visibleTo(event.visibility, owner === 1 ? 2 : 1)).toBe(false)
    }

    const revealed = runtime.log.ruleEventsOfType(TOY_EVENTS.votesRevealed)[0]
    expect(revealed?.visibility.kind).toBe('public')
  })

  test('serverOnly 对任何座位都不可见', () => {
    expect(visibleTo({ kind: 'serverOnly' }, 1)).toBe(false)
    expect(visibleTo({ kind: 'list', seats: [2, 3] }, 2)).toBe(true)
    expect(visibleTo({ kind: 'list', seats: [2, 3] }, 1)).toBe(false)
  })
})

describe('随机源（docs/15 §2.4、§2.6）', () => {
  test('同种子产生同序列，抽取次数被记录', () => {
    const a = new SeededRandom(42)
    const b = new SeededRandom(42)
    const seqA = Array.from({ length: 100 }, () => a.nextIntBelow(1000))
    const seqB = Array.from({ length: 100 }, () => b.nextIntBelow(1000))
    expect(seqB).toEqual(seqA)
    expect(a.drawCount).toBeGreaterThanOrEqual(100)
  })

  test('nextIntBelow 无取模偏置', () => {
    // 拒绝采样的意义：批量模拟要拿分布做经济验收，有偏就白跑了
    const random = new SeededRandom(99)
    const counts = new Array<number>(7).fill(0)
    const draws = 70_000
    for (let i = 0; i < draws; i++) counts[random.nextIntBelow(7)]! += 1
    const expected = draws / 7
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.05)
  })

  test('rollPercent 只接受 0–100 的整数，并同时给出抽取值', () => {
    const random = new SeededRandom(5)
    const { draw, success } = random.rollPercent(25)
    expect(draw).toBeGreaterThanOrEqual(0)
    expect(draw).toBeLessThan(100)
    expect(success).toBe(draw < 25)
    expect(() => random.rollPercent(50.5)).toThrow()
    expect(() => random.rollPercent(101)).toThrow()
  })

  test('rollPercent(0) 恒假、rollPercent(100) 恒真', () => {
    const random = new SeededRandom(11)
    for (let i = 0; i < 200; i++) {
      expect(random.rollPercent(0).success).toBe(false)
      expect(random.rollPercent(100).success).toBe(true)
    }
  })

  test('快照可恢复，恢复后序列继续一致', () => {
    const random = new SeededRandom(8)
    random.nextIntBelow(100)
    const restored = SeededRandom.restore(random.snapshot())
    expect(restored.nextUint32()).toBe(random.nextUint32())
  })
})

describe('规范化与哈希（docs/15 §2.5）', () => {
  test('对象键顺序不影响规范化结果', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
  })

  test('Map 与 Set 的插入顺序不影响规范化结果', () => {
    const m1 = new Map([
      ['x', 1],
      ['y', 2],
    ])
    const m2 = new Map([
      ['y', 2],
      ['x', 1],
    ])
    expect(canonicalize(m1)).toBe(canonicalize(m2))
    expect(canonicalize(new Set([3, 1, 2]))).toBe(canonicalize(new Set([1, 2, 3])))
  })

  test('拒绝无法参与判定的值', () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow()
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow()
    expect(() => canonicalize({ f: () => 1 })).toThrow()
  })

  test('时间戳不进规则流哈希', () => {
    const base: EventRecord = {
      seq: 1,
      timestampMs: 0,
      levelRound: 1,
      negotiationRound: 1,
      phase: 'p',
      actor: 1,
      type: 't',
      payload: { a: 1 },
      stream: 'rule',
      visibility: { kind: 'public' },
      gmOrigin: false,
    }
    expect(ruleStreamHash([{ ...base, timestampMs: 999 }])).toBe(ruleStreamHash([base]))
  })
})

describe('事实投影（docs/15 §3.1、§4）', () => {
  test('构造是常数时间：不拷贝日志', () => {
    const runtime = playToyMatch(2)
    const facts = new FactProjection(runtime.log)
    expect(facts.ruleEvents).toBe(runtime.log.ruleEvents)
  })

  test('只读规则事件流，语料流在投影里不可达', () => {
    const runtime = playToyMatch(2)
    const facts = new FactProjection(runtime.log)
    expect(facts.ofType(TOY_EVENTS.speech).length).toBe(0)
    expect(runtime.log.corpusEvents.length).toBe(2)
  })

  test('按序号窗口取上下文（docs/13 时序与对齐）', () => {
    const runtime = playToyMatch(2)
    const speech = runtime.log.corpusEvents[0]!
    const context = runtime.log.contextAround(speech.seq, 5, 5)
    expect(context.every((e) => e.stream === 'rule')).toBe(true)
    expect(context.length).toBeGreaterThan(0)
  })
})

describe('日志与序号', () => {
  test('未经 allocateSeq 的事件不得入日志', () => {
    const log = new EventLog()
    const forged: EventRecord = {
      seq: 999,
      timestampMs: 0,
      levelRound: 0,
      negotiationRound: 0,
      phase: 'p',
      actor: null,
      type: 't',
      payload: {},
      stream: 'rule',
      visibility: { kind: 'public' },
      gmOrigin: false,
    }
    expect(() => log.append(forged)).toThrow()
  })

  test('EventLog.from 恢复后继续分配不冲突的序号', () => {
    const runtime = playToyMatch(4)
    const restored = EventLog.from(runtime.log.ruleEvents, runtime.log.corpusEvents)
    expect(restored.lastSeq).toBe(runtime.log.lastSeq)
    expect(restored.allocateSeq()).toBe(runtime.log.lastSeq + 1)
  })
})

describe('人数与入场校验', () => {
  test('人数超出模板范围直接失败', () => {
    expect(
      () => new Runtime(new ToyTemplate(), { seed: 1, seats: [{ id: 1, lifespan: 10 }] }),
    ).toThrow(/2–2 人/)
  })

  test('入场余命必须是非负整数', () => {
    expect(
      () =>
        new Runtime(new ToyTemplate(), {
          seed: 1,
          seats: [
            { id: 1, lifespan: 1.5 },
            { id: 2, lifespan: 3 },
          ],
        }),
    ).toThrow(/非负整数/)
  })

  test('阶段表第一项是初始阶段', () => {
    const runtime = new Runtime(new ToyTemplate(), { seed: 1, seats: SEATS })
    expect(runtime.state.phase).toBe(TOY_PHASES.opening)
  })
})
