# 《终焉之地》

多人社交博弈 + UGC 关卡平台。4–16 名失忆编号在十日轮回中，用余命完成私密密令；前史共振只会激活当前轮回可用的回响，是否发动由玩家决定。

当前实现范围：**T-11「最后提案」MVP**，`docs/15` §11 的 M0–M4。

## 快速开始

```bash
npm install

npm run check      # 类型检查 + 测试 + 构建
npm run sim -- --matches 500   # 批量模拟，输出经济与密令分布

# 真人局：两个终端
PERSIST=0 npm run server       # 权威端 :8787（不落盘）
npm run dev                    # 前端 :5173
# 浏览器打开 http://localhost:5173/?room=T11&name=你的名字
# 点「开始对局」，空位由机器人补齐
```

接 Postgres：

```bash
export DATABASE_URL=postgres://用户:密码@127.0.0.1:5432/terminus
npm run migrate    # 建表
npm run server
npm run e2e        # 端到端验收，含可见性检查
```

## 目录

`docs/15` §1 的分层直接落成包边界，依赖方向严格单向向下，由 `scripts/check-layering.ts` 作为测试保证。

| 包 | 层 | 职责 |
|---|---|---|
| `packages/kernel` | 内核层 | 状态 / 事件 / 归约 / 日志 / 随机源 / 快照 / 事实投影。纯数据、纯函数、可重放 |
| `packages/templates` | 模板层 | `t11/` 与 `toy/`。阶段表、密令、潜规则层、三张绑定表、视图投影 |
| `packages/protocol` | — | 会话层线协议：命令上行、事件下行、断线补发 |
| `packages/server` | 会话层 | 权威端、可见性过滤、计时、机器人补位、Postgres |
| `packages/client` | 表现层 | Phaser 4。只订阅事件，不读状态，不含规则 |
| `packages/sim` | 验证层 | 机器人与批量模拟 |

## 当前实现状态

已完成 M0–M4 与批量模拟：内核可重放、T-11 六轮主流程、12 条密令带证据引用、潜规则层（参与灯 / 裂纹 / 环形脉冲 / 门环 / 共同决策轮 / 完美判定）、会话层可见性过滤与断线重连、Phaser 表现层。

未做（`docs/15` §12 与计划第六节）：回响的激活与发动、碎片与渴望引擎、局后推断管线、轮回容器、GM 操作界面、微信小游戏构建目标。

## 设计真源

| 主题 | 文档 |
|---|---|
| 高概念、**术语表**与边界 | [00 高概念](docs/00-overview.md) |
| 一局、十日轮回与三轴 | [01 核心循环](docs/01-core-loop.md) |
| 余命与记忆 | [02 经济](docs/02-economy-lifespan-memory.md) |
| 私密目标与分配 | [03 密令](docs/03-mandate.md) |
| 回响状态机与平衡 | [04 回响](docs/04-echo.md) |
| 主持人和造关资格 | [05 主持人](docs/05-authority-and-ascension.md) |
| 死亡与轮回结算 | [06 待定](docs/06-death-and-recurrence.md) |
| 模板、地块、关卡包 | [07 关卡](docs/07-level-design.md) |
| AI、UGC 与质量漏斗 | [08 生态](docs/08-host-and-ugc.md) |
| 未决项 | [09 问题台账](docs/09-open-questions.md) |
| GM 验证 | [10 GM](docs/10-gm-and-validation.md) |
| 首个可制作范围 | [11 MVP](docs/11-mvp-echoes.md) |
| T-11 完整关卡规则 | [12 最后提案](docs/12-t11-last-proposal.md) |
| 对局记录与性格推断 | [13 记录与推断](docs/13-record-and-inference.md) |
| 碎片、找回度与渴望值 | [14 碎片与渴望](docs/14-fragments-and-yearning.md) |
| 分层、内核契约与扩展点 | [15 架构设计](docs/15-t11-technical-design.md) |

> 设计文档（`00`–`14`）只记录已锁定规则，未决事项统一在 `09` 讨论；`15` 是架构规格。
> 技术栈落地约定见 [CLAUDE.md](CLAUDE.md) 第四节，不进 `docs/15`。
