/**
 * 视图模型：表现层与模板层之间的契约（docs/15 §1）。
 *
 * 表现层只订阅事件、不读状态、不含任何规则；它按事件类型 + 模板提供的视图描述渲染。
 * 因此本文件里**没有一个具体关卡的词**——「灾痕」「协商轮」这类词汇只作为
 * label / text 字段的字符串内容流过，表现层不解释它们。
 *
 * 第二个关卡只需提供自己的 ViewProjection，界面层一行不改。
 */

import type { EventRecord } from './event.ts'
import type { SeatId } from './state.ts'

export interface SeatView {
  readonly id: SeatId
  readonly label: string
  /** 主数值（本关是余命）。表现层只负责显示，不解释含义。 */
  readonly primaryValue: number
  readonly primaryLabel: string
  /** 次数值（本关是累计承担值）。 */
  readonly secondaryValue: number
  readonly secondaryLabel: string
  readonly fallen: boolean
  /** 是否是当前该行动的座位。 */
  readonly active: boolean
  /** 座位上的标记文字，如「已承诺」「已就绪」。 */
  readonly badges: readonly string[]
  /**
   * 世界内反馈的开关量，如参与灯是否点亮。
   * 只给状态，不给解释——docs/15 §8 要求呈现方式强迫玩家自己去关联。
   */
  readonly lampLit: boolean
}

/** 公共区里的一个可交互对象（本关是一枚灾痕）。 */
export interface PublicItemView {
  readonly id: number
  readonly label: string
  readonly holder: SeatId | null
  /** 世界内反馈：该对象是否出现过裂纹闭合。不附解释文字。 */
  readonly highlighted: boolean
}

/** 当前这名玩家可以提交的一个动作。 */
export interface ActionOption {
  readonly commandType: string
  readonly label: string
  readonly payload: Record<string, unknown>
  /** 为假时表现层置灰并显示 disabledReason。 */
  readonly enabled: boolean
  readonly disabledReason?: string
}

export interface FeedItem {
  readonly seq: number
  readonly text: string
  /** 世界内反馈条目不带解释文字，表现层可用不同样式呈现。 */
  readonly kind: 'rule' | 'worldFeedback' | 'chat'
  readonly speaker?: SeatId
}

export interface ViewModel {
  readonly templateId: string
  readonly phaseId: string
  readonly phaseLabel: string
  readonly roundLabel: string
  readonly seats: readonly SeatView[]
  readonly publicItems: readonly PublicItemView[]
  readonly publicItemsLabel: string
  readonly actions: readonly ActionOption[]
  readonly feed: readonly FeedItem[]
  /** 只对本人可见的秘密信息（本关是密令）。 */
  readonly secret: { readonly title: string; readonly lines: readonly string[] } | null
  /** 对局是否已经结束。 */
  readonly complete: boolean
  /** 终局摘要，未结束时为空。 */
  readonly summary: readonly string[]
}

/**
 * 视图投影：消费**已过滤**的事件流，产出视图模型。
 *
 * 它属于模板层——装的是某个关卡的知识。表现层只认 ViewModel 的通用结构。
 */
export interface ViewProjection {
  /** 逐条消费事件。事件已由会话层按座位过滤，投影看不到不该看的东西。 */
  apply(event: EventRecord): void
  /** 产出当前视图。viewerSeat 为 null 表示旁观。 */
  render(viewerSeat: SeatId | null): ViewModel
}
