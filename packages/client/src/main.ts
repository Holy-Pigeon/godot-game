/**
 * 表现层入口（CLAUDE.md 4.2：浏览器是默认验收手段）。
 *
 * 微信小游戏构建目标当前不做——那一侧需要在这里追加 weapp-adapter 适配层，
 * 并把 platform/weapp.ts 接上；游戏逻辑与场景一行不改。
 */

import Phaser from 'phaser'
import { MatchScene } from './scenes/match.ts'

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#11131a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  scene: [MatchScene],
})
