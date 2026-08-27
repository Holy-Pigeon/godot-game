/**
 * 权威端（docs/15 §1 会话层、§8 可见性）。
 *
 * HTTP 只提供健康检查；对局全部走 WebSocket。
 * TLS 与 wss 升级由 Nginx 反代负责（CLAUDE.md 4.6），本进程只监听明文端口。
 */

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { ruleStreamHash, stateHash, type EventRecord, type SeatId } from '@terminus/kernel'
import {
  decodeClientMessage,
  encode,
  PROTOCOL_VERSION,
  type ServerMessage,
} from '@terminus/protocol'
import { Room } from './room.ts'
import { Storage } from './storage.ts'

const PORT = Number(process.env['PORT'] ?? 8787)
const SEAT_COUNT = Number(process.env['SEAT_COUNT'] ?? 6)
const LIFESPAN = Number(process.env['LIFESPAN'] ?? 30)
const DATABASE_URL = process.env['DATABASE_URL']
const PERSIST = process.env['PERSIST'] !== '0'
const VERSION = 't11-mvp-0.1.0'

if (PERSIST && DATABASE_URL === undefined) {
  // 明确失败，不悄悄降级成不落盘（CLAUDE.md 第二节）
  console.error(
    '缺少 DATABASE_URL。对局记录是 docs/13 的硬性要求，不提供不落盘的降级路径。\n' +
      '本地开发若确实不需要记录，显式设置 PERSIST=0 再启动。',
  )
  process.exit(1)
}

const storage = PERSIST && DATABASE_URL !== undefined ? new Storage(DATABASE_URL) : null

interface Connection {
  readonly socket: WebSocket
  roomCode: string | null
  seat: SeatId | null
}

const rooms = new Map<string, Room>()
const connections = new Map<WebSocket, Connection>()
/** 座位 → 连接。一个座位同时只允许一条活动连接。 */
const seatSockets = new Map<string, WebSocket>()

const seatKey = (roomCode: string, seat: SeatId): string => `${roomCode}#${seat}`

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encode(message))
}

function broadcastRoom(room: Room): void {
  const view = room.view()
  for (const player of view.players) {
    const socket = seatSockets.get(seatKey(room.code, player.seat))
    if (socket !== undefined) send(socket, { kind: 'room', room: view })
  }
}

function getOrCreateRoom(roomCode: string): Room {
  const existing = rooms.get(roomCode)
  if (existing !== undefined) return existing

  const room = new Room({
    roomCode,
    seatCount: SEAT_COUNT,
    lifespan: LIFESPAN,
    // 种子由房间码派生，同一房间码重开会得到同一条随机路径，便于复现问题
    seed: [...roomCode].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7),
    enableTimers: true,
  })

  room.onEvents((seat, events) => {
    const socket = seatSockets.get(seatKey(roomCode, seat))
    if (socket !== undefined) send(socket, { kind: 'events', events })
    void persist(room, events)
  })

  rooms.set(roomCode, room)
  return room
}

const persistedMatches = new Set<string>()

async function persist(room: Room, events: readonly EventRecord[]): Promise<void> {
  if (storage === null) return
  const runtime = room.runtime
  if (runtime === null) return

  try {
    if (!persistedMatches.has(room.code)) {
      persistedMatches.add(room.code)
      await storage.createMatch({
        matchId: room.code,
        templateId: room.templateId,
        seed: runtime.seed,
        seatCount: SEAT_COUNT,
        version: VERSION,
        gmMatch: runtime.gmMatch,
      })
    }
    await storage.appendEvents(room.code, events)

    if (runtime.isComplete) {
      const t = runtime.state.template
      await storage.finishMatch(
        room.code,
        {
          endgameReason: t.endgame?.reason ?? null,
          coDecisionRounds: t.hidden.coDecisionRounds,
          gateRingTurns: t.hidden.gateRingTurns,
          stateHash: stateHash(runtime.state as never),
          ruleStreamHash: ruleStreamHash(runtime.log.ruleEvents),
        },
        runtime.gmMatch,
      )
    }
  } catch (error) {
    // 落盘失败不静默：对局继续，但必须在日志里留下明确记录
    console.error(`房间 ${room.code} 事件落盘失败：`, error)
  }
}

/**
 * 全量事件在服务端持久化，下发的永远是过滤后的子集。
 * 这里额外记一笔：sink 收到的 events 已由 Room 按座位过滤，
 * 而 persist 读的是 runtime.log，即未过滤的全量——两者不能混。
 */

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, version: VERSION, rooms: rooms.size }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (socket) => {
  connections.set(socket, { socket, roomCode: null, seat: null })

  socket.on('message', (raw) => {
    let message
    try {
      message = decodeClientMessage(raw.toString())
    } catch (error) {
      send(socket, { kind: 'error', message: `报文无法解析：${String(error)}` })
      return
    }

    const connection = connections.get(socket)
    if (connection === undefined) return

    switch (message.kind) {
      case 'join': {
        const room = getOrCreateRoom(message.roomCode)
        const occupant = room.join(message.displayName)
        if (occupant === null) {
          send(socket, { kind: 'error', message: '房间已满或对局已开始' })
          return
        }
        connection.roomCode = room.code
        connection.seat = occupant.seat
        seatSockets.set(seatKey(room.code, occupant.seat), socket)
        send(socket, {
          kind: 'joined',
          seat: occupant.seat,
          token: occupant.token,
          room: room.view(),
          protocolVersion: PROTOCOL_VERSION,
        })
        broadcastRoom(room)
        return
      }

      case 'resume': {
        // 断线重连：按 token 认座位，补发该座位可见的增量
        for (const room of rooms.values()) {
          const occupant = room.occupantByToken(message.token)
          if (occupant === undefined) continue
          occupant.connected = true
          connection.roomCode = room.code
          connection.seat = occupant.seat
          seatSockets.set(seatKey(room.code, occupant.seat), socket)
          send(socket, {
            kind: 'joined',
            seat: occupant.seat,
            token: occupant.token,
            room: room.view(),
            protocolVersion: PROTOCOL_VERSION,
          })
          const missed = room.backfill(occupant.seat, message.lastSeq)
          if (missed.length > 0) send(socket, { kind: 'events', events: missed })
          return
        }
        send(socket, { kind: 'error', message: '凭据无效或房间已不存在' })
        return
      }

      case 'start': {
        const room = connection.roomCode === null ? undefined : rooms.get(connection.roomCode)
        if (room === undefined) {
          send(socket, { kind: 'error', message: '尚未加入房间' })
          return
        }
        if (room.view().hostSeat !== connection.seat) {
          send(socket, { kind: 'error', message: '只有房主可以开始对局' })
          return
        }
        room.start()
        broadcastRoom(room)
        const deadline = room.phaseDeadline()
        if (deadline !== null) {
          for (const player of room.view().players) {
            const target = seatSockets.get(seatKey(room.code, player.seat))
            if (target !== undefined) send(target, { kind: 'timer', ...deadline })
          }
        }
        return
      }

      case 'command': {
        const room = connection.roomCode === null ? undefined : rooms.get(connection.roomCode)
        if (room === undefined || connection.seat === null) {
          send(socket, { kind: 'error', message: '尚未加入房间' })
          return
        }
        // actor 取自连接身份，不取客户端报文——客户端无法冒充别人提交命令
        const result = room.submit(connection.seat, message.type, message.payload)
        if (!result.ok) {
          send(socket, { kind: 'rejected', reason: result.reason ?? '命令被拒绝' })
        }
        const deadline = room.phaseDeadline()
        if (deadline !== null) send(socket, { kind: 'timer', ...deadline })
        return
      }
    }
  })

  socket.on('close', () => {
    const connection = connections.get(socket)
    if (connection !== null && connection !== undefined) {
      if (connection.roomCode !== null && connection.seat !== null) {
        const room = rooms.get(connection.roomCode)
        if (room !== undefined) {
          room.markDisconnected(connection.seat)
          seatSockets.delete(seatKey(connection.roomCode, connection.seat))
          broadcastRoom(room)
        }
      }
    }
    connections.delete(socket)
  })
})

async function main(): Promise<void> {
  if (storage !== null && process.env['MIGRATE'] === '1') {
    const here = dirname(fileURLToPath(import.meta.url))
    await storage.migrate(join(here, '../../../scripts/schema.sql'))
    console.log('数据库表已建好')
  }

  httpServer.listen(PORT, () => {
    console.log(`终焉之地权威端已启动：http://localhost:${PORT}（${SEAT_COUNT} 人 / 入场余命 ${LIFESPAN}）`)
    console.log(`对局记录：${storage === null ? '未开启（PERSIST=0）' : 'Postgres'}`)
  })
}

void main()
