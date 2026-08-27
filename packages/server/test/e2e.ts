/**
 * 端到端验证：真人连一个座位，其余由机器人补位，打完整一局。
 *
 * 同时验证 docs/15 §8 的硬性验收——**抓包读不到潜规则量**。
 * 这里检查的是连接上实际收到的报文，不是界面上显示了什么。
 */

import WebSocket from 'ws'
import { createViewProjection } from '@terminus/templates'
import { decodeServerMessage, encode, type ClientMessage } from '@terminus/protocol'
import type { EventRecord } from '@terminus/kernel'

const URL = process.env['WS_URL'] ?? 'ws://localhost:8787'
const ROOM = process.env['ROOM'] ?? `E2E${Date.now() % 100000}`

/** 潜规则内部量：这些事件类型一旦出现在客户端连接上，就是可见性过滤破了。 */
const MUST_NEVER_REACH_CLIENT = [
  't11.coDecisionRoundCounted',
  't11.perfectClearRolled',
  't11.endgameRecorded',
]

const socket = new WebSocket(URL)
const received: EventRecord[] = []
let seat: number | null = null
let done = false
const projection = createViewProjection('t11')

const send = (message: ClientMessage): void => socket.send(encode(message))

socket.on('open', () => {
  send({ kind: 'join', roomCode: ROOM, displayName: '真人玩家' })
})

socket.on('message', (raw: Buffer) => {
  const message = decodeServerMessage(raw.toString())

  if (message.kind === 'joined') {
    seat = message.seat
    console.log(`已入座：编号 ${seat}，房间 ${message.room.roomCode}`)
    send({ kind: 'start' })
    return
  }

  if (message.kind === 'error') {
    console.error('服务端报错：', message.message)
    process.exit(1)
  }

  if (message.kind === 'rejected') {
    // 被拒绝是正常的：状态可能已被机器人推进
    return
  }

  if (message.kind !== 'events') return

  for (const event of message.events) {
    received.push(event)
    projection.apply(event)
  }

  const view = projection.render(seat)
  if (view.complete && !done) {
    done = true
    finish(view.summary)
    return
  }

  // 真人座位：按视图给出的可选动作挑第一个可用的提交
  const available = view.actions.filter((a) => a.enabled)
  const chosen = available[0]
  if (chosen !== undefined) {
    send({ kind: 'command', type: chosen.commandType, payload: chosen.payload })
  }
})

function finish(summary: readonly string[]): void {
  console.log(`\n对局结束，本连接共收到 ${received.length} 条事件`)

  // ── docs/15 §8：抓包读不到潜规则量 ──
  const leaked = received.filter((e) => MUST_NEVER_REACH_CLIENT.includes(e.type))
  const serverOnly = received.filter((e) => e.visibility.kind === 'serverOnly')
  const othersSecrets = received.filter(
    (e) => e.visibility.kind === 'self' && e.visibility.seat !== seat,
  )

  console.log('\n可见性验收：')
  console.log(`  潜规则内部量泄漏   ${leaked.length} 条 ${leaked.length === 0 ? '✓' : '✗'}`)
  console.log(`  serverOnly 事件    ${serverOnly.length} 条 ${serverOnly.length === 0 ? '✓' : '✗'}`)
  console.log(`  他人的仅本人事件   ${othersSecrets.length} 条 ${othersSecrets.length === 0 ? '✓' : '✗'}`)

  // 世界内反馈应该收到——玩家要靠它推理，但不带解释
  const worldFeedback = received.filter((e) =>
    ['t11.participationLampLit', 't11.markCrackClosed', 't11.ringPulse', 't11.gateRingTurned'].includes(
      e.type,
    ),
  )
  console.log(`  世界内反馈收到     ${worldFeedback.length} 条 ${worldFeedback.length > 0 ? '✓' : '✗'}`)

  const myMandate = received.filter((e) => e.type === 't11.mandateDealt')
  console.log(`  自己的密令收到     ${myMandate.length} 条 ${myMandate.length === 1 ? '✓' : '✗'}`)

  console.log('\n终局摘要：')
  for (const line of summary) console.log(`  ${line}`)

  const ok =
    leaked.length === 0 &&
    serverOnly.length === 0 &&
    othersSecrets.length === 0 &&
    worldFeedback.length > 0 &&
    myMandate.length === 1
  console.log(`\n端到端验收：${ok ? '通过' : '失败'}`)
  socket.close()
  process.exit(ok ? 0 : 1)
}

setTimeout(() => {
  console.error('超时：对局未在 60 秒内结束')
  process.exit(1)
}, 60_000)
