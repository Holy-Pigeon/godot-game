/**
 * 对局界面（docs/15 §1 表现层）。
 *
 * 只订阅事件、不读状态、不含任何规则：本场景拿到的是 ViewModel，
 * 里面「灾痕」「协商轮」只是字符串，场景不解释它们的含义。
 *
 * UI 全部走 Phaser 自身渲染，不用 DOM（CLAUDE.md 4.3）。
 * 没有美术资源，因此一律用矩形与文字绘制。
 */

import Phaser from 'phaser'
import type { ActionOption, ViewModel } from '@terminus/kernel'
import type { RoomView } from '@terminus/protocol'
import { Session } from '../session.ts'
import { browserPlatform } from '../platform/browser.ts'

const COLORS = {
  background: 0x11131a,
  panel: 0x1b1f2a,
  panelEdge: 0x2b3141,
  seat: 0x222838,
  seatActive: 0x2f5d50,
  seatFallen: 0x2a1f24,
  lampOn: 0xf2c65c,
  lampOff: 0x3a3f4d,
  markHeld: 0x3b4a6b,
  markFree: 0x4a3b3b,
  markHighlight: 0x7fb0a0,
} as const

const TEXT = {
  title: { fontFamily: 'monospace', fontSize: '20px', color: '#e8e6df' },
  body: { fontFamily: 'monospace', fontSize: '14px', color: '#c9c6bd' },
  dim: { fontFamily: 'monospace', fontSize: '12px', color: '#7c8291' },
  world: { fontFamily: 'monospace', fontSize: '12px', color: '#8fb9ab' },
  chat: { fontFamily: 'monospace', fontSize: '12px', color: '#b9a88f' },
  secret: { fontFamily: 'monospace', fontSize: '13px', color: '#d8b96a' },
} as const

export class MatchScene extends Phaser.Scene {
  #session!: Session
  #layer!: Phaser.GameObjects.Container
  #status = ''
  #view: ViewModel | null = null
  #room: RoomView | null = null
  #notice = ''

  constructor() {
    super('match')
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.background)
    this.#layer = this.add.container(0, 0)

    const params = new URLSearchParams(window.location.search)
    const roomCode = params.get('room') ?? 'T11'
    const displayName = params.get('name') ?? `玩家${Math.floor(Math.random() * 900 + 100)}`
    const wsUrl = params.get('ws') ?? defaultWsUrl()

    this.#session = new Session(browserPlatform, {
      onRoom: (room) => {
        this.#room = room
        this.#redraw()
      },
      onView: (view) => {
        this.#view = view
        this.#redraw()
      },
      onRejected: (reason) => {
        this.#notice = `被拒绝：${reason}`
        this.#redraw()
      },
      onError: (message) => {
        this.#notice = message
        this.#redraw()
      },
      onStatus: (text) => {
        this.#status = text
        this.#redraw()
      },
    })

    this.#session.connect(wsUrl, roomCode, displayName)
    this.scale.on('resize', () => this.#redraw())
    this.#redraw()
  }

  #redraw(): void {
    this.#layer.removeAll(true)
    const width = this.scale.width
    const height = this.scale.height

    this.#header(width)

    if (this.#view === null) {
      this.#lobby(width, height)
      return
    }

    const columnLeft = 16
    const columnMiddle = Math.floor(width * 0.33)
    const columnRight = Math.floor(width * 0.63)

    this.#seatPanel(columnLeft, 96, columnMiddle - columnLeft - 16, height - 112)
    this.#publicPanel(columnMiddle, 96, columnRight - columnMiddle - 16, 240)
    this.#actionPanel(columnMiddle, 352, columnRight - columnMiddle - 16, height - 368)
    this.#feedPanel(columnRight, 96, width - columnRight - 16, height - 112)
  }

  #header(width: number): void {
    const view = this.#view
    this.#panel(16, 16, width - 32, 68)
    this.#text(28, 26, view === null ? '终焉之地 · T-11 最后提案' : view.phaseLabel, TEXT.title)
    this.#text(28, 54, view === null ? '等待开始' : view.roundLabel, TEXT.body)

    const seat = this.#session?.seat
    if (seat !== null && seat !== undefined) {
      this.#text(width - 200, 26, `你是编号 ${seat}`, TEXT.body)
    }
    if (this.#notice !== '') {
      this.#text(width - 200, 54, this.#notice, TEXT.dim)
    }
  }

  #lobby(width: number, height: number): void {
    this.#panel(16, 96, width - 32, height - 112)
    this.#text(32, 116, this.#status, TEXT.body)

    const room = this.#room
    if (room === null) return

    this.#text(32, 148, `房间 ${room.roomCode} · ${room.templateId} · ${room.seatCount} 人`, TEXT.body)
    let y = 180
    for (const player of room.players) {
      const mark = player.connected ? '●' : player.isBot ? '◆' : '○'
      this.#text(32, y, `${mark} 编号 ${player.seat}  ${player.displayName}`, TEXT.body)
      y += 24
    }

    if (!room.started && room.hostSeat === this.#session.seat) {
      this.#button(32, y + 16, 260, 36, '开始对局（空位由机器人补齐）', () => this.#session.start())
    } else if (!room.started) {
      this.#text(32, y + 16, '等待房主开始…', TEXT.dim)
    }
  }

  #seatPanel(x: number, y: number, width: number, height: number): void {
    const view = this.#view
    if (view === null) return
    this.#panel(x, y, width, height)
    this.#text(x + 12, y + 10, '座位', TEXT.title)

    let row = y + 44
    for (const seat of view.seats) {
      const fill = seat.fallen ? COLORS.seatFallen : seat.active ? COLORS.seatActive : COLORS.seat
      this.#layer.add(
        this.add.rectangle(x + 12, row, width - 24, 56, fill).setOrigin(0, 0).setStrokeStyle(1, COLORS.panelEdge),
      )
      // 参与灯：只给状态，不给解释（docs/15 §8）
      this.#layer.add(
        this.add.circle(x + 30, row + 16, 6, seat.lampLit ? COLORS.lampOn : COLORS.lampOff),
      )
      this.#text(x + 46, row + 8, `${seat.label}${seat.fallen ? ' · 失守' : ''}`, TEXT.body)
      this.#text(
        x + 46,
        row + 28,
        `${seat.primaryLabel} ${seat.primaryValue} · ${seat.secondaryLabel} ${seat.secondaryValue}`,
        TEXT.dim,
      )
      if (seat.badges.length > 0) {
        this.#text(x + width - 150, row + 8, seat.badges.join(' '), TEXT.dim)
      }
      row += 64
    }

    // 密令：仅本人可见，服务端过滤保证别人的事件根本不会到达这里
    if (view.secret !== null) {
      const boxY = Math.min(row + 8, y + height - 110)
      this.#layer.add(
        this.add.rectangle(x + 12, boxY, width - 24, 96, COLORS.panel).setOrigin(0, 0).setStrokeStyle(1, 0x6a5a2f),
      )
      this.#text(x + 24, boxY + 10, view.secret.title, TEXT.secret)
      let line = boxY + 34
      for (const text of view.secret.lines) {
        this.#text(x + 24, line, text, TEXT.dim)
        line += 20
      }
    }
  }

  #publicPanel(x: number, y: number, width: number, height: number): void {
    const view = this.#view
    if (view === null) return
    this.#panel(x, y, width, height)
    this.#text(x + 12, y + 10, view.publicItemsLabel, TEXT.title)

    let row = y + 44
    for (const item of view.publicItems) {
      const fill = item.holder === null ? COLORS.markFree : COLORS.markHeld
      const rect = this.add.rectangle(x + 12, row, width - 24, 40, fill).setOrigin(0, 0)
      // 裂纹闭合：只呈现现象，不显示含义
      rect.setStrokeStyle(item.highlighted ? 2 : 1, item.highlighted ? COLORS.markHighlight : COLORS.panelEdge)
      this.#layer.add(rect)
      this.#text(x + 24, row + 12, item.label, TEXT.body)
      row += 48
    }
  }

  #actionPanel(x: number, y: number, width: number, height: number): void {
    const view = this.#view
    if (view === null) return
    this.#panel(x, y, width, height)
    this.#text(x + 12, y + 10, '可选动作', TEXT.title)

    if (view.complete) {
      let line = y + 44
      for (const text of view.summary) {
        this.#text(x + 16, line, text, TEXT.body)
        line += 22
      }
      return
    }

    let row = y + 44
    for (const action of view.actions) {
      if (row > y + height - 44) break
      this.#actionButton(x + 12, row, width - 24, 34, action)
      row += 40
    }
    if (view.actions.length === 0) {
      this.#text(x + 16, y + 48, '此刻没有你可以做的事', TEXT.dim)
    }
  }

  #feedPanel(x: number, y: number, width: number, height: number): void {
    const view = this.#view
    if (view === null) return
    this.#panel(x, y, width, height)
    this.#text(x + 12, y + 10, '记录', TEXT.title)

    const visible = view.feed.slice(-Math.floor((height - 56) / 20))
    let row = y + 40
    for (const item of visible) {
      const style =
        item.kind === 'worldFeedback' ? TEXT.world : item.kind === 'chat' ? TEXT.chat : TEXT.dim
      const prefix = item.speaker === undefined ? '' : `编号 ${item.speaker}：`
      this.#text(x + 12, row, `${prefix}${item.text}`.slice(0, Math.floor(width / 7)), style)
      row += 20
    }
  }

  // ── 绘制原语 ──

  #panel(x: number, y: number, width: number, height: number): void {
    this.#layer.add(
      this.add.rectangle(x, y, width, height, COLORS.panel).setOrigin(0, 0).setStrokeStyle(1, COLORS.panelEdge),
    )
  }

  #text(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle): void {
    this.#layer.add(this.add.text(x, y, text, style))
  }

  #button(x: number, y: number, width: number, height: number, label: string, onClick: () => void): void {
    const rect = this.add.rectangle(x, y, width, height, COLORS.seatActive).setOrigin(0, 0)
    rect.setStrokeStyle(1, COLORS.panelEdge).setInteractive({ useHandCursor: true })
    rect.on('pointerup', onClick)
    this.#layer.add(rect)
    this.#text(x + 12, y + height / 2 - 8, label, TEXT.body)
  }

  #actionButton(x: number, y: number, width: number, height: number, action: ActionOption): void {
    const rect = this.add
      .rectangle(x, y, width, height, action.enabled ? COLORS.seatActive : COLORS.seat)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.panelEdge)
    if (action.enabled) {
      rect.setInteractive({ useHandCursor: true })
      rect.on('pointerup', () => {
        this.#notice = ''
        this.#session.submit(action.commandType, action.payload)
      })
    }
    this.#layer.add(rect)
    const label = action.enabled ? action.label : `${action.label}（${action.disabledReason ?? '不可用'}）`
    this.#text(x + 10, y + height / 2 - 8, label, action.enabled ? TEXT.body : TEXT.dim)
  }
}

function defaultWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // 开发时前端在 vite 端口，权威端在 8787；生产由 Nginx 反代到同源 /ws
  if (window.location.port === '5173') return `${protocol}//${window.location.hostname}:8787`
  return `${protocol}//${window.location.host}/ws`
}
