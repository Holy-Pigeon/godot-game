/** 浏览器平台实现。小游戏侧的对应文件尚不存在（CLAUDE.md 4.2）。 */

import type { Platform, PlatformSocket, PlatformStorage } from './index.ts'

class BrowserSocket implements PlatformSocket {
  readonly #socket: WebSocket

  constructor(url: string) {
    this.#socket = new WebSocket(url)
  }

  send(data: string): void {
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.send(data)
  }

  close(): void {
    this.#socket.close()
  }

  onMessage(handler: (data: string) => void): void {
    this.#socket.addEventListener('message', (event) => handler(String(event.data)))
  }

  onOpen(handler: () => void): void {
    this.#socket.addEventListener('open', () => handler())
  }

  onClose(handler: () => void): void {
    this.#socket.addEventListener('close', () => handler())
  }

  onError(handler: (message: string) => void): void {
    this.#socket.addEventListener('error', () => handler('连接出错'))
  }
}

const storage: PlatformStorage = {
  get: (key) => window.localStorage.getItem(key),
  set: (key, value) => window.localStorage.setItem(key, value),
  remove: (key) => window.localStorage.removeItem(key),
}

export const browserPlatform: Platform = {
  connect: (url) => new BrowserSocket(url),
  storage,
  viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
}
