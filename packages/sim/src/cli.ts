/**
 * 批量模拟（docs/15 §10）。
 *
 * docs/12 的全部数值都只是纸面推算。这个命令把它们跑成实测分布，
 * 并直接回答「否决会不会被用来刷奖池」「哪条密令是白送的」这类结构性问题。
 *
 * 用法：
 *   npm run sim -- --matches 1000
 *   npm run sim -- --matches 500 --lifespan 8      # 参数扫描：压出提前结束路径
 *   npm run sim -- --matches 200 --seats 4
 */

import { runMatch, type MatchResult } from './match.ts'

interface Options {
  matches: number
  seats: number
  lifespan: number
  seed: number
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { matches: 200, seats: 6, lifespan: 30, seed: 1 }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = Number(argv[i + 1])
    if (key === undefined || Number.isNaN(value)) continue
    if (key === '--matches') options.matches = value
    else if (key === '--seats') options.seats = value
    else if (key === '--lifespan') options.lifespan = value
    else if (key === '--seed') options.seed = value
  }
  return options
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index] ?? 0
}

function histogram(values: readonly number[]): string {
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => `${value}:${((100 * count) / values.length).toFixed(0)}%`)
    .join('  ')
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  console.log(
    `批量模拟：${options.matches} 局 · ${options.seats} 人 · 入场余命 ${options.lifespan} · 起始种子 ${options.seed}\n`,
  )

  const results: MatchResult[] = []
  for (let i = 0; i < options.matches; i++) {
    results.push(
      runMatch({
        seed: options.seed + i,
        seatCount: options.seats,
        lifespan: options.lifespan,
      }),
    )
  }

  // ── 经济（docs/02、docs/12 回收等级与净回收） ──
  console.log('【经济】')
  console.log(`  系统净回收    均值 ${mean(results.map((r) => r.netRecovery)).toFixed(2)} 日`)
  console.log(
    `                中位 ${percentile(results.map((r) => r.netRecovery), 50)} · ` +
      `p10 ${percentile(results.map((r) => r.netRecovery), 10)} · ` +
      `p90 ${percentile(results.map((r) => r.netRecovery), 90)}`,
  )
  console.log(`  回收等级      均值 ${mean(results.map((r) => r.recoveryTier)).toFixed(2)}`)
  console.log(`  门票回收      均值 ${mean(results.map((r) => r.ticketTotal)).toFixed(2)} 日`)
  console.log(`  灾痕回收      均值 ${mean(results.map((r) => r.markLossTotal)).toFixed(2)} 日`)
  console.log(`  系统发放      均值 ${mean(results.map((r) => r.awardTotal)).toFixed(2)} 日`)

  // ── 否决（docs/12 验收：否决是否被用来刷奖池） ──
  console.log('\n【否决】')
  console.log(`  整局否决数 F  均值 ${mean(results.map((r) => r.totalVetoes)).toFixed(2)}`)
  console.log(`  分布          ${histogram(results.map((r) => r.totalVetoes))}`)
  console.log(`  无代价推进    均值 ${mean(results.map((r) => r.graceAdvances)).toFixed(2)}`)
  const vetoed = results.filter((r) => r.totalVetoes > 0)
  const clean = results.filter((r) => r.totalVetoes === 0)
  if (vetoed.length > 0 && clean.length > 0) {
    console.log(
      `  有否决局净回收 ${mean(vetoed.map((r) => r.netRecovery)).toFixed(2)} ` +
        `vs 无否决局 ${mean(clean.map((r) => r.netRecovery)).toFixed(2)}`,
    )
  }

  // ── 潜规则（docs/12 共同决策轮与完美通关） ──
  console.log('\n【潜规则】')
  console.log(`  共同决策轮 K  均值 ${mean(results.map((r) => r.coDecisionRounds)).toFixed(2)}`)
  console.log(`  K 分布        ${histogram(results.map((r) => r.coDecisionRounds))}`)
  console.log(`  门环转动      均值 ${mean(results.map((r) => r.gateRingTurns)).toFixed(2)}`)
  const rolled = results.filter((r) => r.perfectClear !== null)
  const cleared = results.filter((r) => r.perfectClear === true)
  console.log(
    `  完美判定      执行 ${rolled.length} 局（${((100 * rolled.length) / results.length).toFixed(1)}%），` +
      `成功 ${cleared.length} 局`,
  )

  // ── 终局与死亡 ──
  console.log('\n【终局】')
  const reasons = new Map<string, number>()
  for (const r of results) reasons.set(r.endgameReason, (reasons.get(r.endgameReason) ?? 0) + 1)
  for (const [reason, count] of [...reasons.entries()].sort()) {
    console.log(`  ${reason.padEnd(20)} ${count} 局（${((100 * count) / results.length).toFixed(1)}%）`)
  }
  console.log(`  规则致死      均值 ${mean(results.map((r) => r.fallenCount)).toFixed(2)} 人`)

  // ── 分密令完成率（docs/15 §7.6：依赖他人的密令若系统性失败会藏在平均值里） ──
  console.log('\n【分密令完成率】')
  const byMandate = new Map<string, { total: number; achieved: number; paid: number }>()
  for (const result of results) {
    for (const outcome of result.mandates) {
      const entry = byMandate.get(outcome.mandateId) ?? { total: 0, achieved: 0, paid: 0 }
      entry.total += 1
      if (outcome.achieved) entry.achieved += 1
      entry.paid += outcome.paid
      byMandate.set(outcome.mandateId, entry)
    }
  }
  for (const [id, entry] of [...byMandate.entries()].sort()) {
    const rate = (100 * entry.achieved) / entry.total
    const flag = rate === 0 ? '  ← 从未达成' : rate > 95 ? '  ← 近乎白送' : ''
    console.log(`  ${id}  ${rate.toFixed(0).padStart(3)}%  (n=${entry.total})${flag}`)
  }

  // ── 确定性自检：同种子必须复现 ──
  const first = results[0]
  if (first !== undefined) {
    const repeat = runMatch({ seed: first.seed, seatCount: options.seats, lifespan: options.lifespan })
    const same = repeat.stateHash === first.stateHash
    console.log(`\n确定性自检：同种子重跑状态哈希${same ? '一致' : '不一致 ← 这是缺陷'}`)
    if (!same) process.exitCode = 1
  }
}

main()
