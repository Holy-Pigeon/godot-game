class_name DummyTemplate
extends "res://core/template/level_template.gd"

## T-DUMMY 玩具模板：2 人、1 轮、投票即结束。
##
## 它唯一的作用是证明内核没有偷偷依赖 T-11（docs/15 §4.6）。
## 没有它，抽象接口会在半年内退化成「T-11 的另一个名字」。

const Ev := preload("res://core/match/match_event.gd")
const VR := preload("res://core/match/validation_result.gd")
const PhaseSpecCls := preload("res://core/template/phase_spec.gd")

const PH_NONE := 0
const PH_VOTE := 1
const PH_ENDED := 2

const C_VOTE := &"LockVote"


class DummyState extends RefCounted:
	var votes: Dictionary = {}
	var ended: bool = false

	func canonical() -> String:
		var keys := votes.keys()
		keys.sort()
		var parts := PackedStringArray()
		for k in keys:
			parts.append("%s=%s" % [str(k), "1" if votes[k] else "0"])
		return "votes{%s} end=%d" % [",".join(parts), 1 if ended else 0]


func id() -> StringName:
	return &"T-DUMMY"


func player_range() -> Vector2i:
	return Vector2i(2, 2)


func phase_specs() -> Array:
	var votes: Array[StringName] = [C_VOTE]
	return [PhaseSpecCls.make(PH_VOTE, &"VOTE", votes)]


func initial_state(_seats: Array) -> RefCounted:
	return DummyState.new()


func begin(_state, _rng) -> Array:
	return [Ev.make(&"MatchStarted", Ev.NO_ACTOR, {"template": String(id())})]


func validate(state, cmd) -> ValidationResult:
	if state.phase != PH_VOTE:
		return VR.reject("not voting")
	if cmd.type != C_VOTE:
		return VR.reject("unknown command")
	if state.tpl.votes.has(cmd.actor):
		return VR.reject("already voted")
	return VR.accept()


func emit(_state, cmd, _rng) -> Array:
	return [Ev.make(&"VoteLocked", cmd.actor, {"approve": bool(cmd.arg("approve", true))})]


func reduce(state, e) -> void:
	match e.type:
		&"MatchStarted":
			state.started = true
		&"RoundStarted":
			state.round = e.payload["round"]
			state.nego = 1
			state.phase = PH_VOTE
		&"VoteLocked":
			state.tpl.votes[e.actor] = e.payload["approve"]
		&"MatchEnded":
			state.tpl.ended = true
			state.ended = true
			state.phase = PH_ENDED


func advance(state, _rng) -> Array:
	if state.ended:
		return []
	match state.phase:
		PH_NONE:
			if not state.started:
				return []
			return [Ev.make(&"RoundStarted", Ev.NO_ACTOR, {"round": 1})]
		PH_VOTE:
			for s in state.alive_seats():
				if not state.tpl.votes.has(s):
					return []
			var approvals := 0
			for s in state.alive_seats():
				if state.tpl.votes[s]:
					approvals += 1
			return [Ev.make(&"MatchEnded", Ev.NO_ACTOR, {
				"end_reason": "COMPLETED", "approvals": approvals,
			})]
	return []
