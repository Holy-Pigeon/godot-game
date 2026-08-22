# 15 · T-11 技术实现方案

> 状态：技术规格 v0.1 ｜ 真源：MVP 首个可运行版本的代码架构
>
> 范围：**只实现 T-11 基础关卡**（[12](12-t11-last-proposal.md)），含潜规则层与双流记录（[13](13-record-and-inference.md)）。
> **不实现回响、碎片、渴望、局后推断**，但必须为它们预留接口。
> 目标引擎：Godot 4.8 / GDScript / Forward+。

## 0 · 两条不可妥协的架构约束

这两条决定了所有其他设计，必须在写第一行业务代码之前落地。

**约束 A · 规则事件流可独立复算。**
[13](13-record-and-inference.md) 的硬性验收是「删掉行为语料流后重放规则事件流，所有结算结果完全一致」。这要求规则内核是**纯函数式、无 Node 依赖、无实时性、无隐藏随机**的。它不能是"UI 顺手改了一下数据"的架构。

**约束 B · 事件载荷现在就要为未来系统备齐字段。**
渴望公式（[14](14-fragments-and-yearning.md)）需要「实际损失量 × 参与系数 × 抵抗系数 × 一致性系数」。四个因子的**原始事实**必须在 MVP 阶段就写进事件流，否则接入渴望引擎时要么改历史 schema，要么丢弃全部早期对局数据。写事件时按"以后要算什么"备字段，比以后补迁移便宜一个数量级。

## 1 · 分层

```text
┌─ ui/            表现层：只订阅事件，不读 state，不含任何规则
├─ net/           会话层：服务端权威、命令上行、事件下行、可见性过滤
├─ templates/     模板层：T-11 的阶段表、命令、结算、潜规则
├─ core/          内核层：纯数据、纯函数、可 headless、可重放
└─ gm/            验证层：直设状态、跳转、快照导出
```

依赖方向严格单向向下。**`core/` 不允许 `extends Node`，不允许引用 `templates/` 下的任何符号。** 这条规则由目录级 lint 保证，是"横向扩展关卡"能力的唯一实质保障。

## 2 · 内核：命令 / 事件 / 归约

### 2.1 三个概念的分工

| 概念 | 含义 | 可否被拒绝 | 是否改变状态 |
|---|---|---|---|
| Command | 玩家或 GM 的**意图** | 可以 | 否 |
| Event | 已经发生的**事实** | 不可以 | 是，且是唯一途径 |
| Reducer | `apply(state, event) -> void` | — | 纯函数，无随机、无 IO、无时间 |

唯一的写路径：

```text
Command → Validator（读 state，产出拒绝原因或事件列表）
        → EventLog.append（分配序号、时间戳、可见性）
        → Reducer.apply（改 state）
        → 广播给订阅者（UI / 日志 / 未来的渴望引擎）
```

**任何绕过这条路径修改 `MatchState` 的代码都是 bug。** 状态字段一律私有 + 只读访问器，只有 Reducer 持有写句柄。

### 2.2 事件结构

对齐 [13](13-record-and-inference.md:28) 的记录格式：

```gdscript
class_name MatchEvent extends RefCounted

var seq: int            # 整局单调递增，两条流共用，不复用
var t_ms: int           # 服务端逻辑时间戳，仅供语料对齐，不参与判定
var round: int          # 关卡轮次 1..6
var nego: int           # 协商轮 1..N
var phase: int          # 阶段编号
var actor: int          # 座位号，系统事件为 -1
var type: StringName    # 事件类型
var payload: Dictionary # 类型专属载荷
var stream: int          # STREAM_RULE | STREAM_CORPUS
var visibility: int      # VIS_PUBLIC | VIS_ACTOR | VIS_LIST | VIS_SERVER
var vis_list: PackedInt32Array
var gm_origin: bool      # GM 注入，隔离用
```

`seq` 由单一计数器分配，两条流**共用同一条序号轴**但物理上写入两个文件，满足"删掉语料流"这个操作在文件层面就是删一个文件。

### 2.3 确定性规则

1. **全部规则数值用 int。** 余命、损失、承担值、奖励都是整数日。禁止在内核出现 `float`。未来渴望系数用定点整数（×100）表达。
2. **随机只有一个来源。** `DeterministicRng(seed)`，任何一次抽取必须**先把结果写成事件**（密令发牌、完美判定 roll）。重放时不重新 roll，只读事件里的结果。
3. **禁止遍历无序容器决定顺序。** 一律按座位号升序或灾痕 id 升序迭代。GDScript `Dictionary` 虽是插入序，但插入序本身可能受网络到达顺序影响。
4. **禁止在内核读系统时间。** 60 秒计时由会话层实现，超时以一个 `PhaseTimedOut` 事件进入内核。

### 2.4 核心文件

```text
core/match/
  match_state.gd        # 纯数据容器
  match_event.gd        # 上面的结构
  event_log.gd          # 追加、序号分配、双流写出、按 seq 窗口查询
  command.gd            # 命令基类 + 校验结果
  match_runtime.gd      # 命令→事件→归约的唯一编排器
  deterministic_rng.gd
  snapshot.gd           # 状态哈希 + 序列化，重放断言用
core/template/
  level_template.gd     # 模板抽象接口 + 三张绑定表（见 §4）
  phase_spec.gd         # 阶段声明
  fact_provider.gd      # 事件流投影查询：密令与谓词共用（见 §5.4）
core/echo/              # MVP 只有接口与空实现
  predicate_vocabulary.gd  # 封闭谓词词表（见 §5.1）
  anchor_registry.gd       # 语义锚点注册表（见 §6，can_apply 恒假）
  compatibility.gd         # 回响 × 模板兼容矩阵校验（见 §4.5）
core/mandate/
  mandate_def.gd        # 密令定义（谓词表达式 + 难度 + 奖励）
  mandate_dealer.gd     # 发令器：分配与排除规则
  mandate_evaluator.gd  # 基于 FactProvider 的一次性求值
core/economy/
  settlement.gd         # 结算顺序
  recovery_ledger.gd    # 回收等级、系统净回收核算
core/hooks/
  event_sink.gd         # 事件订阅接口（见 §7）
```

## 3 · T-11 模板实现

### 3.1 阶段表

[12](12-t11-last-proposal.md:38) 的 9 阶段落成一张**数据表**，而不是一串 `match` 分支：

| 阶段 | 常量 | 接受的命令 | 推进条件 |
|---:|---|---|---|
| 1 | `DISASTER_REVEAL` | 无 | 立即（发出 `DisastersSpawned`） |
| 2 | `SEQUENTIAL_ACTION` | `Claim` / `RequestTransfer` / `Pass` / `RespondTransfer` | 所有存活座位各行动一次 |
| 3 | `ALLOCATION_CHECK` | 无 | 立即 |
| 4 | `ECHO_WINDOW_ALLOC` | （预留） | MVP 恒为立即穿过 |
| 5 | `FREE_TALK` | `Speak` / `PromiseApprove` | 60 秒或全员就绪 |
| 6 | `VOTE_LOCK` | `LockVote` | 全员锁定或超时 |
| 6b | `ECHO_WINDOW_INFO` | （预留） | MVP 恒为立即穿过 |
| 7 | `VOTE_REVEAL` | 无 | 立即 |
| 8 | `SETTLE` / `VETO` | 无 | 立即 |
| 9 | `FINAL_SETTLE` | 无 | 仅第 6 轮通过后 |

**阶段 4 与 6b 现在就必须存在**，即使 MVP 里它们零耗时穿过。回响接入时只是给这两个阶段挂上处理器，不动状态机拓扑。这是最廉价的一次预留。

### 3.2 顺序行动与打断

被申请转移者的回应**不是新阶段**，而是阶段 2 内部的 `pending_response` 子状态：

```text
SEQUENTIAL_ACTION
  ├─ current_seat 提交 RequestTransfer
  ├─ 置 pending_response = {from, to, disaster}
  ├─ 只接受 to 的 RespondTransfer（其余命令拒绝）
  └─ 回应后清空，current_seat 前进
```

回应不消耗被申请者本协商轮的行动（[12:63](12-t11-last-proposal.md)），所以 `has_acted[to]` 不变。

### 3.3 T-11 状态字段

```gdscript
# templates/t11/t11_state.gd
var round: int                      # 1..6
var nego: int                       # 1..N
var act: int                        # 1..3，由 round 推导：ceil(round/2)
var base_loss: int                  # 幕基础损失 + 本轮已否决次数
var veto_total: int                 # 整局累计 F
var seats: Array[SeatState]         # lifespan, alive, burden_value, has_acted
var disasters: Array[DisasterState] # holder_seat(-1 未领), ever_moved
var first_actor: int
var votes: Dictionary               # seat -> bool，揭晓前 VIS_ACTOR
var promises: Array                 # 本协商轮的公开承诺，用于言行差异
var lamps: PackedByteArray          # 本轮参与灯
var joint_rounds: int               # K
var ring: int                       # 门环格数
```

`act` 与 `base_loss` **由 round 与 veto 次数推导，不独立存储**——任何可推导的量都不进状态，避免重放时两处不同步。

### 3.4 结算

严格按 [12:110](12-t11-last-proposal.md) 的三步，且**同时扣除**：

```gdscript
# 第 1 步：先全部算完，再一次性写入。禁止边算边扣。
var losses := {}
for d in disasters:
    losses[d.holder] = losses.get(d.holder, 0) + base_loss
# 第 2 步：写入 + 归零检查 + 失守，同一个事件批次
# 第 3 步：仅第 6 轮 —— 承担奖 + 密令奖
```

承担值等于**该枚灾痕的实际损失**，归最终持有者。`sum(burden_value) == sum(实际扣除)` 是一条永久不变量，写进测试。

### 3.5 潜规则层

`t11_secret.gd` 独立于主流程，只订阅事件：

- **参与灯**：`DisasterClaimed` / `TransferResponded(accept=true)` 的双方各点亮一次 → 发 `LampLit`。回响强制移动**不发** `LampLit`（[12:152](12-t11-last-proposal.md)），这条差异是玩家推理链的关键，接口上必须让效果来源可区分：所有移动类事件带 `cause: CAUSE_VOLUNTARY | CAUSE_ECHO`。**MVP 恒为 `CAUSE_VOLUNTARY`，但字段现在就要有。**
- **共同决策轮**：轮末检查四条件 → `JointRoundAchieved`，`K += 1`，`RingAdvanced`。
- **完美判定**：第 6 轮末一次 roll，事件载荷同时记 `K`、`概率`、`roll 值`、`结果`。缺任何一项都会让重放漂移。
- **三条终局路径**：①六轮打完且全员存活 → 执行 roll；②六轮打完但有人失守 → 不判定；③剩两人提前结束（[12:121](12-t11-last-proposal.md)）→ 不判定。路径 ② 是最常见的一条。三条路径都必须**无条件**写出 `RingSnapshot`（[12:172](12-t11-last-proposal.md)）与 `MatchEnded{ end_reason, perfect_eval, K }`。**`K` 必须在每条路径上都记录**：否则批量模拟只能从"无人死亡"的对局里采到 K，而那恰好是最不具代表性的子集，会系统性高估 K 分布。

### 3.6 密令

`mandate_def` 用**事实谓词表达式**声明，不写 GDScript 逻辑：

```gdscript
# M-09【四人共担】
{
  "id": "M-09", "difficulty": "high", "reward": 3,
  "predicate": ["exists_passed_round",
      ["eq", ["count_distinct_settlers"], 4],
      ["all_settlers_hold", 1]]
}
```

好处有三：新增密令不碰代码；求值天然只读事件流投影，满足可复算；发令器的"排除不可能完成"检查可以对表达式做静态分析（例如指向 `X` 的密令不能分配给 `X` 自己）。

⚠️ **M-07【说话不算】与 M-11【独自逆流】在 6 人局需要他人配合**：正式否决需要 2 张反对票，单人无法独立造成。发令器必须把这类"依赖他人"的密令标记为 `requires_cooperation`，并保证同局至少存在使其可能达成的配置，否则高难密令会系统性失败。

## 4 · 扩展点一：关卡横向扩展与三张绑定表

### 4.1 中间语：为什么不能用关卡词汇写回响

E-03【替】的激活条件如果直接写成"x 曾申请并替我结算过一枚**灾痕**"，这条回响就只能活在 T-11 里——换个拍卖关，"灾痕"这个词不存在，回响当场失效。这与 [04:136](04-echo.md) 要求的"同一条回响在最后提案、契约、轮盘中分别落成对应效果"直接矛盾。

因此**回响与模板两侧都必须说抽象语，中间夹一层模板绑定**：

```text
回响侧（跨模板、跨轮回、永久）        模板侧（本关专属、可替换）
    抽象谓词    ←──── ① 谓词绑定 ────→   本关事件投影
    抽象锚点    ←──── ② 锚点实现 ────→   本关效果动词
    创伤 W1–W8  ←──── ③ 创伤供给 ────→   本关损失来源
```

这层共享词表是整个可扩展性的支点。**回响永远不知道自己跑在哪个关卡里**——这是它能跨模板存活的唯一原因。

### 4.2 模板接口

```gdscript
# core/template/level_template.gd
class_name LevelTemplate extends RefCounted

# —— 本关玩法（与回响无关）——
func id() -> StringName:                       ...  # "T-11"
func player_range() -> Vector2i:               ...  # (4, 8)
func phase_specs() -> Array[PhaseSpec]:        ...  # §3.1 的表
func initial_state(cfg, seats, rng) -> Object: ...
func validate(state, cmd) -> ValidationResult: ...
func reduce(state, event) -> void:             ...
func advance(state) -> Array[MatchEvent]:      ...
func settlement_spec() -> SettlementSpec:      ...

# —— 三张对外绑定表 ——
func predicate_bindings() -> Dictionary:  ...  # ① 抽象谓词 → Callable，见 §5
func anchor_bindings() -> Dictionary:     ...  # ② 抽象锚点 → Callable，见 §6
func trauma_bindings() -> Array:          ...  # ③ 本关事件 → W1–W8，见 §7
```

`MatchRuntime` 只认这个接口。**第二个模板的接入不修改 `core/` 下任何一个文件**——这是架构验收标准，不是愿景。

### 4.3 三张绑定表的性质完全不同

一个模板真正的对外成本不在阶段表和结算（那是本关自己的玩法），而在这三张表。

| # | 表 | 方向 | 是否必需 | 缺失后果 |
|---|---|---|---|---|
| ① | 谓词绑定 | 回响**输入** | 可选，逐条 | 依赖该谓词的回响在本关不可激活 |
| ② | 锚点实现 | 回响**输出** | **L1/L2 必须全实现** | 不得上架（[04:136](04-echo.md)） |
| ③ | 创伤供给 | 渴望**输入** | 必需 | 本关不产生渴望，所有回响卡在快门上 |

②是强制的，这反过来要求**抽象锚点集必须小而通用**——它是所有上架模板的公共义务，见 §6。

③最容易被忽略但同样致命：[14:88](14-fragments-and-yearning.md) 的「T-11 创伤供给」表其实就是这张绑定表的第一个实例。新关卡必须自己写一份，否则打得再惨也不产生渴望。

### 4.4 新增一个关卡的落地物

```text
templates/t14_auction/
  t14_template.gd          # 实现 LevelTemplate
  t14_state.gd
  t14_phases.gd            # 阶段表（数据）
  t14_settlement.gd
  bindings/
    predicates.gd          # ① 抽象谓词 → T-14 事件
    anchors.gd             # ② 抽象锚点 → T-14 效果
    traumas.gd             # ③ T-14 损失 → W1–W8
  data/
    t14_config.tres        # 人数、轮数、损失曲线、门票、奖励
    t14_mandates.tres      # 密令（谓词表达式）
```

新模板 = 新目录 + 实现接口 + 三张绑定表 + Resource。已经数据化、无需写代码的部分：

| 项 | 数据化方式 |
|---|---|
| 人数、轮数、幕、损失曲线、门票、奖励 | Config Resource |
| 阶段流程 | `phase_specs()` 表 |
| 密令 | 谓词表达式 Resource |
| 世界内反馈（灯、裂纹、门环、和弦） | 事件类型 + 表现层订阅表 |
| 经济核算 | `SettlementSpec` 声明式 |

### 4.5 上架校验：回响 × 模板兼容矩阵

模板注册时跑一次静态校验，输出全量矩阵：

```text
T-14 锚点覆盖：L1 2/2 ✓   L2 2/2 ✓          → 可上架
T-14 谓词绑定：6/8
  未绑定：inbound_request_count, stage_index
  受影响：E-02 在本关不可激活

⚠ E-07 引用谓词 grudge_held，无任何上架模板绑定 → 死条目
```

两条判读规则：

- **未绑定谓词不是错误，是合法降级。** [04:104](04-echo.md) 已锁定行为：缺谓词 → 该关无法激活此回响，且**绝不让玩家为无效发动付费**——发动入口根本不出现。上架页如实公示即可。
- **无任何模板绑定的谓词 = 永远不会激活的回响。** 这种死条目不做校验就会静悄悄躺在库里，等着某天有人报"这条回响是不是坏了"。

### 4.6 现在就要做但常被跳过的两件事

1. **`ui/` 不得 `preload` 任何 `templates/t11/` 的符号。** 表现层通过事件类型 + 模板提供的视图描述渲染。一旦 UI 直接引用 T-11 的类，第二个模板就要重写整个界面层。
2. **多模板测试夹具**：M1 阶段就写一个 20 行的 `T-DUMMY` 玩具模板（2 人、1 轮、投票即结束），跑通全链路。它的唯一作用是**证明内核没有偷偷依赖 T-11**。没有它，抽象接口会在半年内退化成"T-11 的另一个名字"。

## 5 · 绑定表 ①：谓词词表（回响激活的输入）

### 5.1 词表是封闭的

```gdscript
# core/echo/predicate_vocabulary.gd —— 封闭、集中、带版本号
const P_PROMISE_BROKEN         := &"promise_broken"
const P_DECISION_FAILED        := &"decision_failed"
const P_BURDEN_TAKEN_FOR_ME    := &"burden_taken_for_me"
const P_TRANSFER_REFUSED       := &"transfer_refused"
const P_INBOUND_REQUEST_COUNT  := &"inbound_request_count"
const P_BURDEN_COUNT           := &"burden_count"
const P_LIFESPAN_QUANTILE      := &"lifespan_quantile"
const P_STAGE_INDEX            := &"stage_index"
```

**不允许各模板自造谓词。** 理由是 [04:104](04-echo.md) 要求可判定、[04:136](04-echo.md) 要求跨模板映射——一旦放开，词表会碎成每个模板一套方言，回响的跨模板性当场归零。

扩词表是平台级决策，但**代价是渐进的**：谓词绑定是可选的（不像锚点强制），所以新增一个谓词不会破坏任何已有模板，只是引用它的新回响在没绑的关里不激活。

### 5.2 抽象谓词 → T-11 绑定

上表八条即可覆盖 MVP 四条回响：

| 抽象谓词 | 语义（跨模板） | T-11 绑定 |
|---|---|---|
| `promise_broken(x)` | 公开表态与最终选择相反 | x 公开承诺认可后投了反对票 |
| `decision_failed(window)` | 集体决议未通过 | 该协商轮被否决 |
| `burden_taken_for_me(x)` | x 承接并实际结算了本应落在我身上的代价 | x 申请接手我持有的灾痕、我同意、最终由 x 结算 |
| `transfer_refused(from,to,window)` | 一次转让请求被拒 | `TransferResponded{accept:false}` |
| `inbound_request_count(me,window)` | 他人向我发起的转让请求数 | 指向我的 `TransferRequested` 计数 |
| `burden_count(subject)` | 当前承担的代价单位数 | 当前持有灾痕数 |
| `lifespan_quantile(subject)` | 余命分位 | 存活者中的余命排名分位 |
| `stage_index()` | 当前强度档 | 当前幕 1/2/3 |

绑定实现长这样：

```gdscript
# templates/t11/bindings/predicates.gd
func burden_taken_for_me(facts, args) -> bool:
    for t in facts.accepted_transfers():
        if t.requester == args.x and t.previous_holder == args.me \
           and facts.settled_by(t.disaster) == args.x:
            return true
    return false
```

拍卖关会用完全不同的事件实现同一个函数名——比如"x 替我补了我拍下却付不起的差额"。

### 5.3 三条实现纪律

- **谓词只读规则事件流**，不读语料流、不读推断结果（[13:64](13-record-and-inference.md) 隔离第 1 条）。这也是「公开承诺」必须是结构化动作的原因：聊天框里说"我认可"永远不能进判定。
- **必须可判定**，返回确定值或 `null`；`has_predicate` 为假时按 §4.5 降级。
- **投影可缓存但必须能从零重建**，缓存与重放结果不一致即测试失败。

### 5.4 这笔成本 MVP 已经预付

密令的达成条件和回响的激活条件**本质是同一种东西**：对事件流的只读投影查询。M-07 需要"承诺后反对"、M-06 需要转移链、M-10 需要余命分位——这些投影 MVP 因为密令**本来就必须实现**。

所以回响输入接口的成本基本已经支付完毕，唯一要求是：**别把这些投影写死在密令模块内部**，而要落在共享的 `FactProvider` 上。

## 6 · 绑定表 ②：语义锚点（回响效果的输出）

### 6.1 冻结的抽象锚点集

L1/L2 是所有上架模板的强制义务，越晚冻结迁移成本越高。**现冻结为四条**，真源见 [04](04-echo.md)：

| 抽象锚点 | T-11 落地 | T-14 拍卖落地 |
|---|---|---|
| `揭示·一次已锁定的选择·L1` | 查看某人锁定的认可/反对票 | 查看某人已封存的出价 |
| `重播·我的一次公开表态·L1` | 重挂我被拒的接手请求 | 重挂我已撤回的报价 |
| `转嫁·一次针对我的判定后果·L2` | 把 x 的一枚灾痕移给我 | 把 x 的一笔债务转到我名下 |
| `转嫁·我的一次判定后果到指定编号·L2` | 把我的一枚灾痕移给 x | 把我的一笔债务转给 x |

同一条 E-03，在 T-11 里是抢灾痕，在拍卖里是接债务，**回响本身一个字都不用改**。L3/L4 按 [04:136](04-echo.md) 可先降级到同系 L2 处理。

```gdscript
# core/template/anchor_registry.gd
func register(anchor: StringName, handler: Callable) -> void
func can_apply(anchor: StringName) -> bool
func apply(anchor: StringName, ctx: Dictionary) -> Array[MatchEvent]
```

### 6.2 MVP 只做三件事，不做实现

1. 注册表存在且为空，`can_apply` 恒假。
2. 阶段 4 / 6b 存在且零耗时穿过。
3. 所有持有者变更事件带 `cause` 字段（§3.5）。

这三件事加起来约 50 行代码，但它们决定了接入回响时是"加模块"还是"重构状态机"。

## 7 · 绑定表 ③：创伤供给与渴望引擎

### 7.1 模板必须声明损失喂哪个伤口

```gdscript
# templates/t11/bindings/traumas.gd —— 对应 14:88 的表
[
  {"when": "promise_broken",        "feeds": ["W1", "W4"]},
  {"when": "proposal_ignored",      "feeds": ["W8"]},
  {"when": "transfer_refused",      "feeds": ["W5"]},
  {"when": "forced_burden",         "feeds": ["W3"]},
  {"when": "near_zero_settlement",  "feeds": ["W2", "W7"]},
  {"when": "loss_caused_by_me",     "feeds": ["W6"]},
]
```

⚠️ 按 [14:98](14-fragments-and-yearning.md)，`W6` 的口径必须是「他人**因我而实际损失余命**」，**不得绑定致人死亡**——6 人局未必常出现失守，绑死会让 E-03 近乎不可激活。

### 7.2 渴望引擎是纯事件消费者

```gdscript
# core/hooks/event_sink.gd
func on_event(e: MatchEvent) -> void
func on_match_end(summary: Dictionary) -> void
```

内核向所有 sink 广播规则事件。MVP 的 sink 只有日志写入器和 UI 适配器；未来加一个 `YearningEngine` 即可，**内核零改动**。

### 7.3 关键：现在就要备齐的载荷字段

[14:73](14-fragments-and-yearning.md) 的四因子对应的原始事实：

| 因子 | 需要的字段 | 承载事件 |
|---|---|---|
| 实际损失量 | `actual_loss`（真实扣除，非名义值，归零时截断后的值） | `LossSettled` |
| 参与系数 | `did_rule_action`（本协商轮是否做过规则层行动） | 由 `TurnPassed` / `Claim` / `Request` 投影 |
| 抵抗系数 | `attempted_avoidance`（是否申请过转移、是否投过反对） | 已有事件可投影 |
| 一致性系数 | `mandate_direction`（本次行动与自身密令方向是否一致） | 需在 `MandateResolved` 与行动事件间建立关联 |

前三项在 MVP 事件流里**自然齐备**，只要 `LossSettled` 记的是截断后的实际值而非名义损失。第四项需要密令求值时输出"哪些事件推进了该密令"的引用列表——建议 MVP 就做，因为它同时是 [13:59](13-record-and-inference.md)「证据强制引用」所需。

### 7.4 新增一条回响：纯数据

```gdscript
# echoes/e05_bu_zai_deng.tres
id         = "E-05"
name       = "【不再等】"                    # 写渴望，不写机制术语（11:55）
trauma     = "W5"                           # 弃绝
coping     = "R3"                           # 逃避
tier       = 1                              # L1 → 燃料 1 枚、可隐蔽
anchor     = "揭示·一次已锁定的选择·L1"
condition  = ["and",
               ["transfer_refused", {"to": "me", "window": "last_round"}],
               ["eq", ["inbound_request_count", {"me": "me", "window": "last_round"}], 0],
               ["lte", ["lifespan_quantile", {"subject": "me"}], 0.33]]
prehistory = [
  "「他说他会来接我」",
  "「我在门口坐到天亮」",
  "「后来我不再看表了」",
  "「那扇门其实一直没锁」",
  "「我是自己不肯走的」"
]
```

**过往经历（前史）就是这几行具名文本**，没有别的东西。它们获得即自动归位、玩家不分配（[14:25](14-fragments-and-yearning.md)），找回度 = 已持有数 / 总数、按回响独立计算。

加载时校验四项：谓词全在词表内、锚点存在于注册表、`prehistory` 数量等于配置碎片数（当前 5）、`tier` 与燃料量匹配（L1=1 / L2=3）。

只有当新回响要表达的东西**现有词表没有**时，才需要碰代码（扩词表，见 §5.1）。

一条**可评审但不可自动校验**的规则（[11:52](11-mvp-echoes.md)）：每条共鸣条件必须能还原成"前史中的什么结构正在重演"。上例的对齐是——前史是"等一个不会来的人"，谓词是"我的请求无人回应 + 我已在余命底部"，同一结构在重演。这条对不齐，回响就退化成贴了叙事皮的技能，正是 [09](09-open-questions.md) 风险台账里「回响共鸣感失败」的成因。

### 7.5 尚缺的一块数据

新回响能否真正长出来，还卡在一个未定案的映射上：[14:29](14-fragments-and-yearning.md) 规定密令完成产出的碎片"归该密令类别对应的创伤"，但 [12](12-t11-last-proposal.md) 的 12 条密令一条都没标 W 编号。

MVP 处理：`mandate_def` 预留 `trauma: StringName` 字段，留空。真要新增回响时这张表必须先定，否则新回响的前史碎片没有掉落来源，找回度永远是 0。

## 8 · 网络与可见性

服务端权威。Godot High-Level Multiplayer + ENet；MVP 允许房主即服务端。

```text
Client                    Server
  │ ── rpc submit_command ──▶ MatchRuntime.validate
  │                            ├─ 拒绝 → rpc_id 回执给发起者
  │                            └─ 通过 → 追加事件
  │ ◀── rpc_id / rpc 广播 ──── VisibilityFilter.route(event)
```

**可见性过滤必须在第一版就做**，事后补极痛：

| 内容 | 可见性 |
|---|---|
| 密令 | `VIS_ACTOR` |
| 私聊 | `VIS_LIST` |
| 锁定前的投票 | `VIS_ACTOR`，`VoteRevealed` 时才转 `VIS_PUBLIC` |
| 潜规则内部量（K、门环含义、完美概率） | `VIS_SERVER`，永不下发 |
| 世界内反馈（灯、裂纹、门环转动） | `VIS_PUBLIC`，但**不附带任何解释文字** |

最后一条是设计要求而非技术要求（[12:170](12-t11-last-proposal.md)）：客户端**不能拿到** `joint_rounds` 的值，否则玩家可以扒包直接读出潜规则。门环只下发"转了一格"这个事件本身。

## 9 · GM 与验证

[10](10-gm-and-validation.md) 要求 GM 能直设状态、跳转流程且不污染正式数据。

- GM 操作也是命令 → 事件，只是 `gm_origin = true`。这样 GM 局同样可重放，也自动满足"导出状态快照、事件日志、随机种子和版本号"。
- 任何一局只要含 `gm_origin` 事件，整局标记为 GM 局，结算结果不写入正式余命账本。
- `snapshot.gd` 提供状态哈希，用于重放断言与 GM 快照双重用途。

## 10 · 测试策略

这套架构的全部价值都要靠测试兑现，否则会在三个月内退化。

| 测试 | 内容 | 对应验收 |
|---|---|---|
| 黄金重放 | 录制一局 → 重放 → 状态哈希逐事件一致 | 约束 A |
| 单流重放 | 删除语料流后重放，结算数值完全一致 | [13:99](13-record-and-inference.md) |
| 不变量 fuzz | 随机合法命令序列，断言：灾痕恒为 4 枚、单人 ≤ 2 枚、余命 ≥ 0、`sum(burden) == sum(loss)`、失守者无后续行动 | 规则正确性 |
| 玩具模板 | `T-DUMMY` 跑通全链路 | §4.3，横向扩展能力 |
| 批量模拟 | headless 机器人跑 1000 局，输出净回收 / 否决率 / 密令完成率 / K 分布 | [12:228](12-t11-last-proposal.md) 经济验收 |
| 经济复算 | 从事件流独立重算回收等级与系统净回收 | [12:251](12-t11-last-proposal.md) |

运行方式：`godot --headless -s res://tests/run_all.gd`，不引入外部测试框架依赖（GUT 可后加）。

**批量模拟是这个项目性价比最高的一项投入**：[12](12-t11-last-proposal.md) 的全部数值（32 日净回收、K 分布、完美通关率、密令完成率 50%）都只是纸面推算，靠真人试跑验证需要几十局。有了确定性内核和机器人，这些数字一晚上就能跑出来，且能直接回答"否决会不会被用来刷奖池"这类结构性问题。

## 11 · 里程碑

| # | 内容 | 完成判据 |
|---|---|---|
| M0 | 内核：命令/事件/归约/日志/RNG/快照 | 黄金重放测试通过 |
| M1 | T-11 主流程（阶段 1–9，无潜规则、无密令、无 UI） | headless 跑完 6 轮，经济数字可复算 |
| M2 | 密令 + 事实层 + `T-DUMMY` | 12 条密令可求值；玩具模板不改 `core/` 跑通 |
| M3 | 潜规则层 + 表现层（灯 / 裂纹 / 门环 / 和弦） | 玩家可从反馈推出 §3.5 的可推理链 |
| M4 | 网络 + 可见性过滤 + 私聊 | 6 人真人局可完整进行；抓包读不到潜规则量 |
| M5 | GM 控制台 + 批量模拟 | [10](10-gm-and-validation.md) 三个必测场景可执行 |

M0–M2 是纯逻辑，无美术依赖，可以先行。回响、碎片、渴望、推断在 M5 之后作为**新增模块**接入，届时应当只改 `templates/t11/` 与新增 `core/echo/`，不触动内核编排。

## 12 · 未决项对实现的影响

| 未决项 | 阻塞什么 | MVP 处理 |
|---|---|---|
| G0 死亡与轮回结算（[06](06-death-and-recurrence.md)） | 跨局持久化、余命带入 | MVP 单局闭环，余命由外部注入，不实现轮回容器 |
| 密令类别 → 创伤映射（[14:135](14-fragments-and-yearning.md)） | 碎片掉落 | `mandate_def.trauma` 字段留空 |
| 阈值正式数值 | 回响激活 | 不在 MVP 范围 |
| 语音转写 | 语料流完整性 | MVP 降级为纯文字，schema 预留 `confidence` 字段 |
