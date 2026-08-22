class_name TestHarness
extends RefCounted

const SeatStateCls := preload("res://core/match/seat_state.gd")
const RuntimeCls := preload("res://core/match/match_runtime.gd")
const RngCls := preload("res://core/match/deterministic_rng.gd")
const SnapshotCls := preload("res://core/match/snapshot.gd")
const T11 := preload("res://templates/t11/t11_template.gd")
const T11ConfigCls := preload("res://templates/t11/t11_config.gd")
const Bot := preload("res://tests/bots/random_bot.gd")


static func make_seats(n: int, lifespan: int) -> Array:
	var out: Array = []
	for i in range(n):
		out.append(SeatStateCls.make(i + 1, lifespan))
	return out


static func run_t11(seed_value: int, seat_count: int = 6, lifespan: int = 20,
		with_speech: bool = false) -> Dictionary:
	var cfg = T11ConfigCls.make_default()
	cfg.seat_count = seat_count
	cfg.start_lifespan = lifespan
	var tpl = T11.new(cfg)
	var rt = RuntimeCls.new(tpl, make_seats(seat_count, lifespan), seed_value)
	if with_speech:
		rt.add_sink(SpeechInjector.new(rt, seed_value))
	rt.start()
	var play := Bot.play(rt, RngCls.new(seed_value ^ 0x5EED))
	return {
		"rt": rt,
		"template": tpl,
		"config": cfg,
		"play": play,
		"fingerprint": SnapshotCls.fingerprint(rt.state, rt.log),
	}


## 往语料流里塞发言，用于验证「删掉行为语料流后重放，结算完全一致」。
class SpeechInjector extends RefCounted:
	var _rt
	var _rng
	var _busy := false

	func _init(rt, seed_value: int) -> void:
		_rt = rt
		_rng = RngCls.new(seed_value ^ 0xC0FFEE)

	func on_event(e) -> void:
		if _busy or not e.is_rule():
			return
		if e.type != &"FreeTalkStarted":
			return
		_busy = true
		for s in _rt.state.alive_seats():
			if _rng.percent() <= 60:
				_rt.speak(s, "我扛不动了" if _rng.percent() <= 50 else "这轮我认可")
		_busy = false

	func on_match_end(_summary: Dictionary) -> void:
		pass
