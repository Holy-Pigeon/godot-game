/**
 * 平台能力接口（CLAUDE.md 4.3）。
 *
 * 需要平台能力（存储、网络）时一律走这层封装，不在游戏逻辑里直接调 wx.* 或摸 window。
 * 当前只有浏览器实现；微信小游戏实现文件尚不存在（CLAUDE.md 4.2），
 * 不是留了空函数——那一侧真正开始做时新增 weapp.ts，游戏逻辑一行不改。
 */

export interface PlatformSocket {
  send(data: string): void
  close(): void
  onMessage(handler: (data: string) => void): void
  onOpen(handler: () => void): void
  onClose(handler: () => void): void
  onError(handler: (message: string) => void): void
}

export interface PlatformStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface Platform {
  connect(url: string): PlatformSocket
  readonly storage: PlatformStorage
  viewport(): { readonly width: number; readonly height: number }
}
