extends SceneTree

## godot --headless --path <project> -s res://tests/run_all.gd
## 不引入外部测试框架依赖。

const Harness := preload("res://tests/harness.gd")
const RuntimeCls := preload("res://core/match/match_runtime.gd")
const SnapshotCls := preload("res://core/match/snapshot.gd")
const SeatStateCls := preload("res://core/match/seat_state.gd")
const RngCls := preload("res://core/match/deterministic_rng.gd")
const CmdCls := preload("res://core/match/command.gd")
const T11 := preload("res://templates/t11/t11_template.gd")
const T11ConfigCls := preload("res://templates/t11/t11_config.gd")
const Dummy := preload("res://templates/dummy/dummy_template.gd")
const Compat := preload("res://core/echo/compatibility.gd")
const Vocab := preload("res://core/echo/predicate_vocabulary.gd")

var _failures := 0
var _checks := 0


func _initialize() -> void:
	print("=== 终焉之地 · T-11 MVP headless 测试 ===\n")
	_test_smoke()
	_test_golden_replay()
	_test_single_stream_replay()
	_test_invariants()
	_test_dummy_template()
	_test_compatibility()
	_batch_simulation()
	print("\n=== %d 项断言，%d 项失败 ===" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)


func _check(ok: bool, label: String, detail: String = "") -> bool:
	_checks += 1
	if not ok:
		_failures += 1
		printerr("  FAIL  %s %s" % [label, detail])
	return ok


func _section(title: String) -> void:
	print("--- %s" % title)


# ————————————————————————————————— 冒烟 —————————————————————————————————

func _test_smoke() -> void:
	_section("冒烟：一局能否跑完")
	var r := Harness.run_t11(1)
	var play: Dictionary = r["play"]
	if not _check(play["ok"], "对局完成", str(play.get("reason", ""))):
		return
	var st = r["rt"].state
	var ended = r["rt"].log.last_of_type(&"MatchEnded")
	_check(st.ended, "状态已结束")
	_check(ended != null, "存在 MatchEnded 事件")
	if ended != null:
		print("  轮次 %d · 终局 %s · K=%d · 门环 %d · 否决 %d · 存活 %d/%d · 命令 %d · 事件 %d" % [
			st.round, ended.payload["end_reason"], ended.payload["k"],
			ended.payload["ring"], ended.payload["veto_total"],
			ended.payload["survivors"], st.seat_count(),
			play["commands"], r["rt"].log.size(),
		])
		_check(r["rt"].log.last_of_type(&"RingSnapshot") != null,
			"门环留档无条件执行")
		_check(r["rt"].log.last_of_type(&"PerfectEval") != null,
			"完美判定在每条终局路径都记录 K")


# ————————————————————————————————— 黄金重放 —————————————————————————————————

func _test_golden_replay() -> void:
	_section("黄金重放：录一局 → 重放 → 状态哈希一致")
	for seed_value in [7, 42, 1337]:
		var r := Harness.run_t11(seed_value)
		if not _check(r["play"]["ok"], "seed %d 跑通" % seed_value):
			continue
		var live = r["fingerprint"]
		var replayed = RuntimeCls.replay(
			r["template"],
			Harness.make_seats(6, r["config"].start_lifespan),
			r["rt"].log.rule_events())
		var h := SnapshotCls.of_state(replayed)
		_check(h == live["state"], "seed %d 状态哈希一致" % seed_value,
			"live=%d replay=%d" % [live["state"], h])
		_check(replayed.canonical() == r["rt"].state.canonical(),
			"seed %d 规范化状态逐字一致" % seed_value)

	# 同种子两次运行必须完全一致
	var a := Harness.run_t11(99)
	var b := Harness.run_t11(99)
	_check(a["fingerprint"]["rule_stream"] == b["fingerprint"]["rule_stream"],
		"同种子两次运行的规则流一致")


# ————————————————————————————————— 单流重放 —————————————————————————————————

func _test_single_stream_replay() -> void:
	_section("单流重放：删掉行为语料流后结算完全一致")
	var r := Harness.run_t11(2024, 6, 20, true)
	if not _check(r["play"]["ok"], "含语料流的对局跑通"):
		return
	var rt = r["rt"]
	var corpus: int = rt.log.corpus_events().size()
	_check(corpus > 0, "语料流非空", "corpus=%d" % corpus)

	var replayed = RuntimeCls.replay(
		r["template"], Harness.make_seats(6, 20), rt.log.rule_events())
	_check(SnapshotCls.of_state(replayed) == SnapshotCls.of_state(rt.state),
		"仅用规则事件流即可复算整局")

	# 语料流不得参与任何判定：它连一次 reduce 都不应触发
	var mixed = RuntimeCls.replay(
		r["template"], Harness.make_seats(6, 20), rt.log.all_events())
	_check(mixed.canonical() == replayed.canonical(),
		"混入语料流不改变任何结算数值")


# ————————————————————————————————— 不变量 —————————————————————————————————

func _test_invariants() -> void:
	_section("不变量 fuzz：40 局随机合法命令序列")
	var bad := 0
	for i in range(40):
		var r := Harness.run_t11(5000 + i * 17)
		if not r["play"]["ok"]:
			bad += 1
			printerr("  seed %d: %s" % [5000 + i * 17, r["play"]["reason"]])
			continue
		var msg := _verify_invariants(r["rt"], r["config"])
		if msg != "":
			bad += 1
			printerr("  seed %d: %s" % [5000 + i * 17, msg])
	_check(bad == 0, "40 局全部满足不变量", "违规 %d 局" % bad)


func _verify_invariants(rt, cfg) -> String:
	var lifespan := {}
	var holder := {}
	var eliminated := {}
	var round_no := 0
	var seen_rounds: Array = []

	for e in rt.log.rule_events():
		if eliminated.has(e.actor) and e.actor != -1:
			return "失守者 %d 在 seq %d 仍产生事件 %s" % [e.actor, e.seq, e.type]
		match e.type:
			&"MatchStarted":
				var ids: Array = e.payload["seats"]
				var lps: Array = e.payload["lifespans"]
				for i in range(ids.size()):
					lifespan[ids[i]] = lps[i]
			&"RoundStarted":
				round_no = e.payload["round"]
				if seen_rounds.has(round_no):
					return "关卡轮次 %d 重复" % round_no
				seen_rounds.append(round_no)
			&"DisastersSpawned":
				holder = {}
				var ids2: Array = e.payload["ids"]
				if ids2.size() != cfg.disasters_per_round:
					return "第 %d 轮灾痕数为 %d" % [round_no, ids2.size()]
				for d in ids2:
					holder[d] = -1
			&"DisasterClaimed":
				holder[e.payload["disaster"]] = e.actor
				if _count(holder, e.actor) > cfg.max_hold:
					return "座位 %d 持有超过 %d 枚" % [e.actor, cfg.max_hold]
			&"TransferResponded":
				if e.payload["accept"]:
					holder[e.payload["disaster"]] = e.payload["requester"]
					if _count(holder, e.payload["requester"]) > cfg.max_hold:
						return "座位 %d 转入后超过 %d 枚" % [e.payload["requester"], cfg.max_hold]
			&"ProposalPassed":
				for d in holder:
					if holder[d] == -1:
						return "第 %d 轮方案通过时灾痕 %s 无人承担" % [round_no, str(d)]
			&"LossSettled":
				var before: int = lifespan[e.actor]
				var expect_actual: int = mini(e.payload["nominal"], before)
				if e.payload["actual"] != expect_actual:
					return "座位 %d 实际损失 %d ≠ min(%d, %d)" % [
						e.actor, e.payload["actual"], e.payload["nominal"], before]
				if e.payload["lifespan_after"] != before - expect_actual:
					return "座位 %d 结算后余命不一致" % e.actor
				if e.payload["lifespan_after"] < 0:
					return "座位 %d 余命为负" % e.actor
				if e.payload["count"] != _count(holder, e.actor):
					return "座位 %d 结算枚数与持有不符" % e.actor
				lifespan[e.actor] = e.payload["lifespan_after"]
			&"PlayerEliminated":
				if lifespan[e.actor] != 0:
					return "座位 %d 在余命 %d 时失守" % [e.actor, lifespan[e.actor]]
				eliminated[e.actor] = true
			&"FinalAward", &"PerfectRefund":
				lifespan[e.actor] = lifespan[e.actor] + e.payload["amount"]

	# 承担值总和 == 实际扣除总和
	var t = rt.state.tpl
	var sum_burden := 0
	var sum_loss := 0
	for s in t.burden:
		sum_burden += t.burden[s]
	for s in t.total_loss:
		sum_loss += t.total_loss[s]
	if sum_burden != sum_loss:
		return "sum(burden)=%d ≠ sum(loss)=%d" % [sum_burden, sum_loss]
	return ""


func _count(holder: Dictionary, seat: int) -> int:
	var n := 0
	for d in holder:
		if holder[d] == seat:
			n += 1
	return n


# ————————————————————————————————— 玩具模板 —————————————————————————————————

func _test_dummy_template() -> void:
	_section("T-DUMMY：证明内核没有偷偷依赖 T-11")
	var tpl = Dummy.new()
	var seats := Harness.make_seats(2, 5)
	var rt = RuntimeCls.new(tpl, seats, 3)
	rt.start()
	var ok := true
	for s in [1, 2]:
		var res = rt.submit(CmdCls.make(&"LockVote", s, {"approve": true}))
		ok = ok and res.ok
	_check(ok, "两条命令均被接受")
	_check(rt.state.ended, "玩具模板走到终局")
	var replayed = RuntimeCls.replay(tpl, Harness.make_seats(2, 5), rt.log.rule_events())
	_check(replayed.canonical() == rt.state.canonical(), "玩具模板同样可重放")


# ————————————————————————————————— 兼容矩阵 —————————————————————————————————

func _test_compatibility() -> void:
	_section("回响 × 模板兼容矩阵")
	var echoes := [
		{"id": "E-01", "predicates": [Vocab.P_PROMISE_BROKEN, Vocab.P_DECISION_FAILED]},
		{"id": "E-02", "predicates": [Vocab.P_TRANSFER_REFUSED,
			Vocab.P_INBOUND_REQUEST_COUNT, Vocab.P_LIFESPAN_QUANTILE]},
		{"id": "E-03", "predicates": [Vocab.P_BURDEN_TAKEN_FOR_ME]},
		{"id": "E-04", "predicates": [Vocab.P_BURDEN_COUNT, Vocab.P_TRANSFER_REFUSED]},
	]
	var rep := Compat.report([T11.new(), Dummy.new()], echoes)
	for line in Compat.format(rep).split("\n"):
		print("  " + line)
	var t11_row: Dictionary = rep["templates"][0]
	_check(t11_row["predicates"] == "8/8", "T-11 绑定全部谓词", str(t11_row["predicates"]))
	_check(not t11_row["admissible"], "MVP 未实现锚点 → T-11 尚不可上架（符合预期）")
	_check((rep["dead_entries"] as Array).is_empty(), "四条 MVP 回响无死条目")


# ————————————————————————————————— 批量模拟 —————————————————————————————————

func _batch_simulation() -> void:
	_section("批量模拟：200 局经济与 K 分布")
	var n := 200
	var net_total := 0
	var vetoes := 0
	var deaths := 0
	var early := 0
	var perfect_eval := 0
	var perfect_ok := 0
	var k_dist := {}
	var rounds_total := 0
	var failed := 0

	for i in range(n):
		var r := Harness.run_t11(100000 + i * 31)
		if not r["play"]["ok"]:
			failed += 1
			continue
		var rt = r["rt"]
		var cfg = r["config"]
		var tickets: int = cfg.seat_count * cfg.ticket
		var loss := 0
		var awards := 0
		for e in rt.log.rule_events():
			match e.type:
				&"LossSettled":
					loss += e.payload["actual"]
				&"FinalAward", &"PerfectRefund":
					awards += e.payload["amount"]
				&"PlayerEliminated":
					deaths += 1
		net_total += tickets + loss - awards
		var ended = rt.log.last_of_type(&"MatchEnded")
		vetoes += ended.payload["veto_total"]
		rounds_total += rt.state.round
		if ended.payload["end_reason"] == "EARLY_TWO_LEFT":
			early += 1
		var k: int = ended.payload["k"]
		k_dist[k] = int(k_dist.get(k, 0)) + 1
		var pe = rt.log.last_of_type(&"PerfectEval")
		if pe.payload["executed"]:
			perfect_eval += 1
			if pe.payload["success"]:
				perfect_ok += 1

	var done := n - failed
	_check(failed == 0, "200 局全部跑通", "失败 %d 局" % failed)
	if done == 0:
		return
	print("  平均系统净回收   %.1f 日/局（未含密令奖，密令属 M2）" % (float(net_total) / done))
	print("  平均否决次数     %.2f" % (float(vetoes) / done))
	print("  平均完成轮次     %.2f" % (float(rounds_total) / done))
	print("  规则致死         %d 人次（%.2f 人/局）" % [deaths, float(deaths) / done])
	print("  提前结束         %d 局" % early)
	print("  完美判定执行     %d 局，成功 %d 局" % [perfect_eval, perfect_ok])
	var keys := k_dist.keys()
	keys.sort()
	var parts := PackedStringArray()
	for k in keys:
		parts.append("K=%d:%d" % [k, k_dist[k]])
	print("  共同决策轮分布   " + "  ".join(parts))
