class_name T11Template
extends "res://core/template/level_template.gd"

## T-11「最后提案」。规则真源：docs/12-t11-last-proposal.md
## 阶段是数据表，不是一串 match 分支（docs/15 §3.1）。

const Ev := preload("res://core/match/match_event.gd")
const VR := preload("res://core/match/validation_result.gd")
const PhaseSpecCls := preload("res://core/template/phase_spec.gd")
const T11StateCls := preload("res://templates/t11/t11_state.gd")
const T11ConfigCls := preload("res://templates/t11/t11_config.gd")
const Secret := preload("res://templates/t11/t11_secret.gd")
const Anchors := preload("res://core/echo/anchor_registry.gd")
const Vocab := preload("res://core/echo/predicate_vocabulary.gd")

# —— 阶段 ——
const PH_NONE := 0
const PH_SPAWN := 1
const PH_ACTION := 2
const PH_ALLOC := 3
const PH_ECHO_ALLOC := 4       ## MVP 恒为零耗时穿过，但阶段现在就必须存在
const PH_TALK := 5
const PH_VOTE := 6
const PH_ECHO_INFO := 7        ## 同上
const PH_VOTE_REVEAL := 8
const PH_RESOLVE := 9
const PH_FINAL := 10
const PH_ENDED := 11

# —— 命令 ——
const C_CLAIM := &"Claim"
const C_REQUEST := &"RequestTransfer"
const C_RESPOND := &"RespondTransfer"
const C_PASS := &"Pass"
const C_PROMISE := &"PromiseApprove"
const C_READY := &"TalkReady"
const C_VOTE := &"LockVote"

# —— 终局原因 ——
const END_COMPLETED := &"COMPLETED"
const END_EARLY := &"EARLY_TWO_LEFT"
const PE_EXECUTED := &"EXECUTED"
const PE_SKIPPED := &"SKIPPED_DEATH"

var config: T11Config


func _init(p_config = null) -> void:
	config = p_config if p_config != null else T11ConfigCls.make_default()


func id() -> StringName:
	return &"T-11"


func player_range() -> Vector2i:
	return Vector2i(4, 8)


func phase_specs() -> Array:
	var no_cmd: Array[StringName] = []
	var act: Array[StringName] = [C_CLAIM, C_REQUEST, C_RESPOND, C_PASS]
	var talk: Array[StringName] = [C_PROMISE, C_READY]
	var vote: Array[StringName] = [C_VOTE]
	return [
		PhaseSpecCls.make(PH_SPAWN, &"DISASTER_REVEAL", no_cmd, true),
		PhaseSpecCls.make(PH_ACTION, &"SEQUENTIAL_ACTION", act),
		PhaseSpecCls.make(PH_ALLOC, &"ALLOCATION_CHECK", no_cmd, true),
		PhaseSpecCls.make(PH_ECHO_ALLOC, &"ECHO_WINDOW_ALLOC", no_cmd, true),
		PhaseSpecCls.make(PH_TALK, &"FREE_TALK", talk),
		PhaseSpecCls.make(PH_VOTE, &"VOTE_LOCK", vote),
		PhaseSpecCls.make(PH_ECHO_INFO, &"ECHO_WINDOW_INFO", no_cmd, true),
		PhaseSpecCls.make(PH_VOTE_REVEAL, &"VOTE_REVEAL", no_cmd, true),
		PhaseSpecCls.make(PH_RESOLVE, &"RESOLVE", no_cmd, true),
		PhaseSpecCls.make(PH_FINAL, &"FINAL_SETTLE", no_cmd, true),
	]


func initial_state(seats: Array) -> RefCounted:
	var t := T11StateCls.new()
	for s in seats:
		t.burden[s.id] = 0
		t.settled_count[s.id] = 0
		t.total_loss[s.id] = 0
	return t


func begin(state, _rng) -> Array:
	var lifespans: Array = []
	var ids: Array = []
	for s in state.seats:
		ids.append(s.id)
		lifespans.append(s.lifespan)
	return [Ev.make(&"MatchStarted", Ev.NO_ACTOR, {
		"template": String(id()),
		"seats": ids,
		"lifespans": lifespans,
		"ticket": config.ticket,
	})]


# ————————————————————————————————— 校验 —————————————————————————————————

func validate(state, cmd) -> ValidationResult:
	var t = state.tpl
	var seat = state.seat(cmd.actor)
	if seat == null or not seat.alive:
		return VR.reject("actor not alive")

	match state.phase:
		PH_ACTION:
			if not t.pending.is_empty():
				if cmd.type != C_RESPOND:
					return VR.reject("awaiting transfer response")
				if cmd.actor != t.pending["target"]:
					return VR.reject("only the request target may respond")
				return VR.accept()
			if cmd.type == C_RESPOND:
				return VR.reject("no pending request")
			if cmd.actor != t.current_seat():
				return VR.reject("not your turn")
			match cmd.type:
				C_PASS:
					return VR.accept()
				C_CLAIM:
					if t.holdings(cmd.actor) >= config.max_hold:
						return VR.reject("hold limit reached")
					var did: int = cmd.arg("disaster", -1)
					var d: Dictionary = t.disaster(did)
					if d.is_empty():
						return VR.reject("unknown disaster")
					if d["holder"] != -1:
						return VR.reject("disaster already held")
					return VR.accept()
				C_REQUEST:
					if t.holdings(cmd.actor) >= config.max_hold:
						return VR.reject("hold limit reached")
					var rid: int = cmd.arg("disaster", -1)
					var rd: Dictionary = t.disaster(rid)
					if rd.is_empty():
						return VR.reject("unknown disaster")
					if rd["holder"] == -1:
						return VR.reject("disaster unheld; claim it instead")
					if rd["holder"] == cmd.actor:
						return VR.reject("already yours")
					var holder = state.seat(rd["holder"])
					if holder == null or not holder.alive:
						return VR.reject("holder not alive")
					return VR.accept()
			return VR.reject("command not accepted in SEQUENTIAL_ACTION")
		PH_TALK:
			if cmd.type == C_PROMISE:
				if t.promises.has(cmd.actor):
					return VR.reject("already promised this nego round")
				return VR.accept()
			if cmd.type == C_READY:
				return VR.accept()
			return VR.reject("command not accepted in FREE_TALK")
		PH_VOTE:
			if cmd.type != C_VOTE:
				return VR.reject("command not accepted in VOTE_LOCK")
			if t.votes.has(cmd.actor):
				return VR.reject("vote already locked")
			return VR.accept()
	return VR.reject("phase %d accepts no commands" % state.phase)


# ————————————————————————————————— 产出事实 —————————————————————————————————

func emit(state, cmd, _rng) -> Array:
	var t = state.tpl
	match cmd.type:
		C_PASS:
			return [Ev.make(&"TurnPassed", cmd.actor, {})]
		C_CLAIM:
			var did: int = cmd.arg("disaster", -1)
			var out: Array = [Ev.make(&"DisasterClaimed", cmd.actor, {
				"disaster": did, "cause": Ev.CAUSE_VOLUNTARY,
			})]
			out += _lamp_events(state, [cmd.actor])
			return out
		C_REQUEST:
			var rid: int = cmd.arg("disaster", -1)
			return [Ev.make(&"TransferRequested", cmd.actor, {
				"disaster": rid, "target": t.disaster(rid)["holder"],
			})]
		C_RESPOND:
			var accept: bool = bool(cmd.arg("accept", false))
			var p: Dictionary = t.pending
			var out2: Array = [Ev.make(&"TransferResponded", cmd.actor, {
				"requester": p["requester"], "target": p["target"],
				"disaster": p["disaster"], "accept": accept,
				"cause": Ev.CAUSE_VOLUNTARY,
			})]
			if accept:
				var d: Dictionary = t.disaster(p["disaster"])
				if not d["moved"]:
					out2.append(Ev.make(&"CrackHealed", Ev.NO_ACTOR, {"disaster": p["disaster"]}))
				out2 += _lamp_events(state, [p["requester"], p["target"]])
			return out2
		C_PROMISE:
			return [Ev.make(&"PromiseApprove", cmd.actor, {})]
		C_READY:
			return [Ev.make(&"TalkReady", cmd.actor, {})]
		C_VOTE:
			return [Ev.make(&"VoteLocked", cmd.actor,
				{"approve": bool(cmd.arg("approve", true))}, Ev.VIS_ACTOR)]
	return []


## 参与灯：首次持有、成功申请接手、同意别人接走都点亮；
## 回响强制移动不点灯（docs/12 世界内线索）——故此处只处理 CAUSE_VOLUNTARY。
func _lamp_events(state, seats: Array) -> Array:
	var t = state.tpl
	var out: Array = []
	var newly: Array = []
	for s in seats:
		if not t.lamps.has(s) and not newly.has(s):
			newly.append(s)
	newly.sort()
	for s in newly:
		out.append(Ev.make(&"LampLit", s, {}))
	if not t.pulsed:
		var alive: Array = state.alive_seats()
		var lit := 0
		for a in alive:
			if t.lamps.has(a) or newly.has(a):
				lit += 1
		if lit == alive.size() and alive.size() > 0:
			out.append(Ev.make(&"AllLampsPulse", Ev.NO_ACTOR, {"seats": alive.size()}))
	return out


# ————————————————————————————————— 归约 —————————————————————————————————

func reduce(state, e) -> void:
	var t = state.tpl
	match e.type:
		&"MatchStarted":
			state.started = true
		&"RoundStarted":
			state.round = e.payload["round"]
			t.vetoes_this_round = 0
			t.lamps = {}
			t.pulsed = false
		&"DisastersSpawned":
			t.disasters = []
			for did in e.payload["ids"]:
				t.disasters.append({"id": did, "holder": -1, "moved": false})
			state.phase = PH_SPAWN
		&"NegoStarted":
			state.nego = e.payload["nego"]
			var order: Array[int] = []
			for s in e.payload["order"]:
				order.append(s)
			t.turn_order = order
			t.turn_idx = 0
			t.first_actor = e.payload["first_actor"]
			t.acted = {}
			t.pending = {}
			t.promises = {}
			t.ready = {}
			t.votes = {}
			state.phase = PH_ACTION
		&"TurnPassed":
			t.acted[e.actor] = true
			t.turn_idx += 1
		&"DisasterClaimed":
			t.disaster(e.payload["disaster"])["holder"] = e.actor
			t.acted[e.actor] = true
			t.turn_idx += 1
		&"TransferRequested":
			t.pending = {
				"requester": e.actor,
				"target": e.payload["target"],
				"disaster": e.payload["disaster"],
			}
		&"TransferResponded":
			if e.payload["accept"]:
				var d: Dictionary = t.disaster(e.payload["disaster"])
				d["holder"] = e.payload["requester"]
				d["moved"] = true
			t.acted[e.payload["requester"]] = true
			t.turn_idx += 1
			t.pending = {}
		&"LampLit":
			t.lamps[e.actor] = true
		&"AllLampsPulse":
			t.pulsed = true
		&"AllocationChecked":
			state.phase = PH_ALLOC
		&"EchoWindow":
			state.phase = PH_ECHO_ALLOC if e.payload["kind"] == "alloc" else PH_ECHO_INFO
		&"FreeTalkStarted":
			state.phase = PH_TALK
		&"PromiseApprove":
			t.promises[e.actor] = true
		&"TalkReady":
			t.ready[e.actor] = true
		&"FreeTalkEnded":
			state.phase = PH_VOTE
		&"VoteLocked":
			t.votes[e.actor] = e.payload["approve"]
		&"VotesRevealed":
			state.phase = PH_RESOLVE
		&"ProposalVetoed":
			t.vetoes_this_round += 1
			t.veto_total += 1
		&"LossSettled":
			var seat = state.seat(e.actor)
			seat.lifespan = e.payload["lifespan_after"]
			t.settled_count[e.actor] = t.settled_count[e.actor] + e.payload["count"]
			t.total_loss[e.actor] = t.total_loss[e.actor] + e.payload["actual"]
			t.burden[e.actor] = t.burden[e.actor] + e.payload["actual"]
		&"PlayerEliminated":
			state.seat(e.actor).alive = false
		&"JointRound":
			t.joint_rounds = e.payload["k"]
		&"RingAdvanced":
			t.ring = e.payload["ring"]
		&"FinalAward":
			var s2 = state.seat(e.actor)
			s2.lifespan = s2.lifespan + e.payload["amount"]
			state.phase = PH_FINAL
		&"PerfectEval":
			t.perfect_eval = PE_EXECUTED if e.payload["executed"] else PE_SKIPPED
			t.perfect_success = bool(e.payload.get("success", false))
		&"PerfectRefund":
			var s3 = state.seat(e.actor)
			s3.lifespan = s3.lifespan + e.payload["amount"]
		&"MatchEnded":
			t.end_reason = StringName(e.payload["end_reason"])
			state.ended = true
			state.phase = PH_ENDED


# ————————————————————————————————— 自动推进 —————————————————————————————————

func advance(state, rng) -> Array:
	if state.ended:
		return []
	var t = state.tpl
	match state.phase:
		PH_NONE:
			if not state.started:
				return []
			return _begin_round(state, 1)
		PH_ACTION:
			if not t.pending.is_empty():
				return []
			if t.turn_idx < t.turn_order.size():
				return []
			return [
				Ev.make(&"AllocationChecked", Ev.NO_ACTOR, {"allocated": t.all_allocated()}),
				Ev.make(&"EchoWindow", Ev.NO_ACTOR, {"kind": "alloc", "applied": 0}),
				Ev.make(&"FreeTalkStarted", Ev.NO_ACTOR, {}),
			]
		PH_TALK:
			for s in state.alive_seats():
				if not t.ready.has(s):
					return []
			return [Ev.make(&"FreeTalkEnded", Ev.NO_ACTOR, {})]
		PH_VOTE:
			var alive: Array = state.alive_seats()
			for s in alive:
				if not t.votes.has(s):
					return []
			var tally := {}
			var rejects := 0
			for s in alive:
				tally[s] = t.votes[s]
				if not t.votes[s]:
					rejects += 1
			return [
				Ev.make(&"EchoWindow", Ev.NO_ACTOR, {"kind": "info", "applied": 0}),
				Ev.make(&"VotesRevealed", Ev.NO_ACTOR, {"votes": tally, "rejects": rejects}),
			]
		PH_RESOLVE:
			return _resolve(state, rng)
	return []


func _first_actor_for_round(state, round_no: int) -> int:
	var n: int = state.seats.size()
	var start: int = (round_no - 1) % n
	for k in range(n):
		var s = state.seats[(start + k) % n]
		if s.alive:
			return s.id
	return -1


func _next_alive_after(state, seat_id: int) -> int:
	var n: int = state.seats.size()
	var idx := 0
	for i in range(n):
		if state.seats[i].id == seat_id:
			idx = i
			break
	for k in range(1, n + 1):
		var s = state.seats[(idx + k) % n]
		if s.alive:
			return s.id
	return seat_id


func _begin_round(state, round_no: int) -> Array:
	var first := _first_actor_for_round(state, round_no)
	var ids: Array = []
	for i in range(config.disasters_per_round):
		ids.append(round_no * 10 + i)
	var out: Array = [
		Ev.make(&"RoundStarted", Ev.NO_ACTOR, {
			"round": round_no,
			"act": config.act_of_round(round_no),
			"base_loss": config.base_loss_of_round(round_no),
			"first_actor": first,
		}),
		Ev.make(&"DisastersSpawned", Ev.NO_ACTOR, {"ids": ids}),
	]
	out += _begin_nego(state, 1, first)
	return out


func _begin_nego(state, nego_no: int, first_actor: int) -> Array:
	var alive: Array = state.alive_seats()
	alive.sort()
	var order: Array = []
	var start := 0
	for i in range(alive.size()):
		if alive[i] == first_actor:
			start = i
			break
	for k in range(alive.size()):
		order.append(alive[(start + k) % alive.size()])
	return [Ev.make(&"NegoStarted", Ev.NO_ACTOR, {
		"nego": nego_no, "first_actor": first_actor, "order": order,
	})]


func _resolve(state, rng) -> Array:
	var t = state.tpl
	var alive: Array = state.alive_seats()
	var rejects := 0
	for s in alive:
		if not t.votes.get(s, true):
			rejects += 1
	var allocated: bool = t.all_allocated()
	var approvals := alive.size() - rejects
	var need := alive.size() - 1

	if allocated and approvals >= need:
		return _settle(state, rng, alive, rejects)

	# 第一协商轮仅因未分完而未通过，且反对票不超过 1 张 → 无代价进入第二轮
	if state.nego == 1 and not allocated and rejects <= 1:
		var out: Array = [Ev.make(&"GraceExtension", Ev.NO_ACTOR, {"rejects": rejects})]
		out += _begin_nego(state, state.nego + 1, _next_alive_after(state, t.first_actor))
		return out

	var reason := "opposition" if rejects >= 2 else "unallocated"
	var out2: Array = [Ev.make(&"ProposalVetoed", Ev.NO_ACTOR, {
		"reason": reason, "rejects": rejects, "allocated": allocated,
	})]
	out2 += _begin_nego(state, state.nego + 1, _next_alive_after(state, t.first_actor))
	return out2


func _settle(state, rng, alive: Array, rejects: int) -> Array:
	var t = state.tpl
	var base: int = t.base_loss(state.round, config)
	var out: Array = [Ev.make(&"ProposalPassed", Ev.NO_ACTOR, {
		"rejects": rejects, "base_loss": base,
	})]

	# 第 1 步：先全部算完，再一次性写入；所有灾痕同时扣除
	var counts := {}
	for d in t.disasters:
		counts[d["holder"]] = int(counts.get(d["holder"], 0)) + 1
	var holders: Array = counts.keys()
	holders.sort()
	var eliminated: Array = []
	for h in holders:
		var seat = state.seat(h)
		var nominal: int = counts[h] * base
		var actual: int = mini(nominal, seat.lifespan)
		var after: int = seat.lifespan - actual
		out.append(Ev.make(&"LossSettled", h, {
			"count": counts[h], "nominal": nominal, "actual": actual,
			"lifespan_after": after, "base_loss": base,
			"did_rule_action": t.acted.has(h),
		}))
		if after == 0:
			eliminated.append(h)

	# 第 2 步：立即检查归零并处理失守
	for h in eliminated:
		out.append(Ev.make(&"PlayerEliminated", h, {"cause": "settlement"}))

	# 潜规则层：共同决策轮（内部量，不下发）
	out += Secret.evaluate_round(state, alive, rejects, eliminated)

	# 第 3 步：终局或下一关卡轮次
	var alive_after := alive.size() - eliminated.size()
	if alive_after <= config.early_end_alive:
		out += _final(state, rng, END_EARLY, alive, eliminated)
	elif state.round >= config.rounds:
		out += _final(state, rng, END_COMPLETED, alive, eliminated)
	else:
		out += _begin_round_deferred(state, eliminated)
	return out


## 下一关卡轮次的首位行动者必须按「结算之后」的存活状态计算，
## 但 RoundStarted 尚未归约，故先剔除本轮失守者再算。
func _begin_round_deferred(state, eliminated: Array) -> Array:
	var next_round: int = state.round + 1
	var n: int = state.seats.size()
	var start: int = (next_round - 1) % n
	var first := -1
	for k in range(n):
		var s = state.seats[(start + k) % n]
		if s.alive and not eliminated.has(s.id):
			first = s.id
			break
	var ids: Array = []
	for i in range(config.disasters_per_round):
		ids.append(next_round * 10 + i)
	var out: Array = [
		Ev.make(&"RoundStarted", Ev.NO_ACTOR, {
			"round": next_round,
			"act": config.act_of_round(next_round),
			"base_loss": config.base_loss_of_round(next_round),
			"first_actor": first,
		}),
		Ev.make(&"DisastersSpawned", Ev.NO_ACTOR, {"ids": ids}),
	]
	var survivors: Array = []
	for s in state.seats:
		if s.alive and not eliminated.has(s.id):
			survivors.append(s.id)
	survivors.sort()
	var order: Array = []
	var st := 0
	for i in range(survivors.size()):
		if survivors[i] == first:
			st = i
			break
	for k in range(survivors.size()):
		order.append(survivors[(st + k) % survivors.size()])
	out.append(Ev.make(&"NegoStarted", Ev.NO_ACTOR, {
		"nego": 1, "first_actor": first, "order": order,
	}))
	return out


func _final(state, rng, end_reason: StringName, alive_before: Array, eliminated: Array) -> Array:
	var t = state.tpl
	var out: Array = []
	var survivors: Array = []
	for s in alive_before:
		if not eliminated.has(s):
			survivors.append(s)

	# 最终承担奖：失守者不能获奖，名次顺延
	survivors.sort_custom(func(a, b):
		if t.burden[a] != t.burden[b]:
			return t.burden[a] > t.burden[b]
		if t.settled_count[a] != t.settled_count[b]:
			return t.settled_count[a] > t.settled_count[b]
		var ea: int = state.seat(a).entry_lifespan
		var eb: int = state.seat(b).entry_lifespan
		if ea != eb:
			return ea < eb
		return a < b)
	var awards := [config.award_first + t.veto_total, config.award_second + t.veto_total]
	for i in range(mini(2, survivors.size())):
		out.append(Ev.make(&"FinalAward", survivors[i], {
			"rank": i + 1, "amount": awards[i], "burden": t.burden[survivors[i]],
		}))

	# 完美判定：仅「六轮打完且所有入场玩家仍存活」时执行
	var all_alive: bool = survivors.size() == state.seats.size()
	var k: int = t.joint_rounds
	if end_reason == END_COMPLETED and all_alive:
		var pct: int = config.perfect_percent(k)
		var roll: int = rng.percent()
		var success: bool = pct > 0 and roll <= pct
		out.append(Ev.make(&"PerfectEval", Ev.NO_ACTOR, {
			"executed": true, "k": k, "percent": pct, "roll": roll, "success": success,
		}, Ev.VIS_SERVER))
		if success:
			for s in survivors:
				out.append(Ev.make(&"PerfectRefund", s, {
					"ticket": config.ticket,
					"loss_refund": t.total_loss[s],
					"bonus": config.perfect_bonus,
					"amount": config.ticket + t.total_loss[s] + config.perfect_bonus,
				}))
	else:
		# K 必须在每条终局路径上都记录，否则批量模拟只能从「无人死亡」的对局
		# 采样，会系统性高估 K 分布（docs/15 §3.5）
		out.append(Ev.make(&"PerfectEval", Ev.NO_ACTOR, {
			"executed": false, "k": k, "reason": "not_all_alive",
		}, Ev.VIS_SERVER))

	# 门环留档无条件执行，不以完美判定是否执行为条件（docs/12）
	out.append(Ev.make(&"RingSnapshot", Ev.NO_ACTOR, {
		"ring": t.ring, "round_reached": state.round,
	}))
	out.append(Ev.make(&"MatchEnded", Ev.NO_ACTOR, {
		"end_reason": String(end_reason),
		"perfect_eval": String(PE_EXECUTED if (end_reason == END_COMPLETED and all_alive) else PE_SKIPPED),
		"k": k,
		"ring": t.ring,
		"veto_total": t.veto_total,
		"survivors": survivors.size(),
	}))
	return out


# ————————————————————————————————— 三张绑定表 —————————————————————————————————

func predicate_bindings() -> Dictionary:
	var b := preload("res://templates/t11/bindings/predicates.gd").new()
	return b.table()


## MVP：锚点注册表存在但为空，can_apply 恒假（docs/15 §6.2）。
func anchor_bindings() -> Dictionary:
	return {}


func trauma_bindings() -> Array:
	return preload("res://templates/t11/bindings/traumas.gd").TABLE
