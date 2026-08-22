class_name RandomBot
extends RefCounted

## headless 机器人：把 T-11 完整跑起来，用于重放、不变量与批量模拟。
## 机器人的随机性属于会话层，不进内核；重放只用录下来的事件。

const Cmd := preload("res://core/match/command.gd")
const T11 := preload("res://templates/t11/t11_template.gd")

const MAX_COMMANDS := 20000


## 返回 {ok, commands, reason}
static func play(rt, bot_rng) -> Dictionary:
	var issued := 0
	while not rt.state.ended:
		if issued > MAX_COMMANDS:
			return {"ok": false, "commands": issued, "reason": "command cap exceeded"}
		var cmd = _decide(rt.state, bot_rng)
		if cmd == null:
			return {"ok": false, "commands": issued, "reason":
				"no legal command at phase %d" % rt.state.phase}
		var res = rt.submit(cmd)
		if not res.ok:
			return {"ok": false, "commands": issued, "reason":
				"rejected %s: %s" % [str(cmd), res.reason]}
		issued += 1
	return {"ok": true, "commands": issued, "reason": ""}


static func _decide(state, rng):
	var t = state.tpl
	match state.phase:
		T11.PH_ACTION:
			if not t.pending.is_empty():
				var target: int = t.pending["target"]
				# 协商轮拖得越久越倾向于放手，避免恶意死锁
				var accept_chance: int = 40 + 20 * state.nego
				return Cmd.make(T11.C_RESPOND, target,
					{"accept": rng.percent() <= accept_chance})
			var seat: int = t.current_seat()
			if seat == -1:
				return null
			return _decide_action(state, rng, seat)
		T11.PH_TALK:
			for s in state.alive_seats():
				if not t.ready.has(s):
					if not t.promises.has(s) and rng.percent() <= 35:
						return Cmd.make(T11.C_PROMISE, s, {})
					return Cmd.make(T11.C_READY, s, {})
			return null
		T11.PH_VOTE:
			for s in state.alive_seats():
				if not t.votes.has(s):
					# 否决会同时抬高灾痕损失与所有人的生存风险，
					# 因此反对倾向随协商轮下降
					var reject_chance: int = maxi(2, 18 - 6 * state.nego)
					return Cmd.make(T11.C_VOTE, s, {"approve": rng.percent() > reject_chance})
			return null
	return null


static func _decide_action(state, rng, seat: int):
	var t = state.tpl
	var free: Array = t.unclaimed()
	var mine: int = t.holdings(seat)
	var forced: bool = state.nego >= 2   # 第二协商轮起未分完直接导致否决

	if mine < 2 and not free.is_empty():
		var claim_chance: int = 100 if forced else 55
		if rng.percent() <= claim_chance:
			return Cmd.make(T11.C_CLAIM, seat, {"disaster": free[rng.range_int(0, free.size() - 1)]})

	# 主动申请接手别人的灾痕：最终承担奖让这件事有理由发生
	if mine < 2 and rng.percent() <= 25:
		var others: Array = []
		for d in t.disasters:
			if d["holder"] != -1 and d["holder"] != seat:
				var h = state.seat(d["holder"])
				if h != null and h.alive:
					others.append(d["id"])
		if not others.is_empty():
			return Cmd.make(T11.C_REQUEST, seat,
				{"disaster": others[rng.range_int(0, others.size() - 1)]})

	return Cmd.make(T11.C_PASS, seat, {})
