# 设计文档索引

## 三分钟读懂

《终焉之地》让 4–16 名编号在一张关卡桌上各自完成私密密令，并以余命承担风险。十关构成一轮十日轮回；玩家通过记忆拼回前史，在特定情景下激活回响，再自行决定是否发动。激活仅持续当前轮回，下一轮回一律回到普通编号。

## 阅读路径

| 目的 | 阅读顺序 |
|---|---|
| 查某个词是什么意思 | [00 术语](00-overview.md#术语)；T-11 专属词见 [12 本关术语](12-t11-last-proposal.md#本关术语) |
| 了解游戏 | [00](00-overview.md) → [01](01-core-loop.md) → [11](11-mvp-echoes.md) |
| 设计回响 | [04](04-echo.md) → [14](14-fragments-and-yearning.md) → [13](13-record-and-inference.md) → [07](07-level-design.md) → [10](10-gm-and-validation.md) |
| 运行 T-11 MVP | [12 最后提案](12-t11-last-proposal.md) → [11 MVP 回响](11-mvp-echoes.md) |
| 实现 T-11 | [12 最后提案](12-t11-last-proposal.md) → [15 架构设计](15-t11-technical-design.md) → [13](13-record-and-inference.md) |
| 设计关卡 | [03](03-mandate.md) → [07](07-level-design.md) → [08](08-host-and-ugc.md) |
| 设计经济 | [02](02-economy-lifespan-memory.md) → [09](09-open-questions.md) |
| 讨论未知项 | [06](06-death-and-recurrence.md) → [09](09-open-questions.md) |

## 已锁定决策

| 决策 | 真源 |
|---|---|
| 无阵营；密令制造私人目标 | [00](00-overview.md)、[03](03-mandate.md) |
| 日是个人轮回进度，十日为一轮回 | [01](01-core-loop.md) |
| 余命是唯一硬通货 | [02](02-economy-lifespan-memory.md) |
| 回响情景激活、玩家主动发动、仅持续当前轮回 | [04](04-echo.md) |
| 回响通过语义锚点和情境谓词接入模板 | [04](04-echo.md)、[07](07-level-design.md) |
| 每条回响每关最多发动一次 | [04](04-echo.md) |
| 激活是三重合取：找回度、渴望值、共振情境 | [04](04-echo.md)、[14](14-fragments-and-yearning.md) |
| 碎片具名且自动归位；无游离燃料库存，发动只能烧已拼回的碎片 | [14](14-fragments-and-yearning.md) |
| 已拼回的碎片跨轮回永久保留 | [14](14-fragments-and-yearning.md)、[02](02-economy-lifespan-memory.md) |
| 对局按严格时序全量记录决策与发言 | [13](13-record-and-inference.md) |
| MVP 无系统托管约定，玩家间不存在余命流动 | [12](12-t11-last-proposal.md) |
| 局后性格推断只移动形状，不进入任何判定，且对玩家不可见 | [13](13-record-and-inference.md) |
| 任何玩家都能造关；创建者不可作为编号进入自己的关卡 | [05](05-authority-and-ascension.md)、[07](07-level-design.md) |
| 规则裁决胜负；主持人不裁判胜负 | [05](05-authority-and-ascension.md)、[08](08-host-and-ugc.md) |
| 死亡与轮回结算尚未设计 | [06](06-death-and-recurrence.md) |

旧论证、替代方案和已关闭问题不再保留在主规格中；需要恢复时应从 Git 历史读取，而不是复制回正文。
