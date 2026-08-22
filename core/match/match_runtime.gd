class_name MatchRuntime
extends RefCounted

## 命令 → 事件 → 归约 的唯一编排器。
## 任何绕过这条路径修改 MatchState 的代码都是 bug（docs/15 §2.1）。

const MatchStateCls := preload("res://core/match/match_state.gd")
const SeatStateCls := preload("res://core/match/seat_state.gd")
const EventLogCls := preload("res://core/match/event_log.gd")
const RngCls := preload("res://core/match/deterministic_rng.gd")
const ValidationResultCls := preload("res://core/match/validation_result.gd")
const FactProviderCls := preload("res://core/template/fact_provider.gd")

const PUMP_GUARD := 4096

var state: MatchState
var log: EventLog
var facts: FactProvider
var template: RefCounted
var rng: DeterministicRng
var seed_value: int = 0

var _sinks: Array = []
var _rejections: int = 0


func _init(p_template: RefCounted, p_seats: Array, p_seed: int) -> void:
	template = p_template
	seed_value = p_seed
	rng = RngCls.new(p_seed)
	log = EventLogCls.new()
	facts = FactProviderCls.new(log)
	state = MatchStateCls.new()
	var typed: Array[SeatState] = []
	for s in p_seats:
		typed.append(s)
	state.seats = typed
	state.tpl = template.initial_state(p_seats)


func add_sink(sink) -> void:
	_sinks.append(sink)


func rejections() -> int:
	return _rejections


func start() -> void:
	assert(not state.started, "match already started")
	for e in template.begin(state, rng, facts):
		_commit(e)
	_pump()


func submit(cmd) -> ValidationResult:
	if state.ended:
		_rejections += 1
		return ValidationResultCls.reject("match ended")
	var res: ValidationResult = template.validate(state, cmd)
	if not res.ok:
		_rejections += 1
		return res
	for e in template.emit(state, cmd, rng, facts):
		e.gm_origin = cmd.gm_origin
		_commit(e)
	_pump()
	return res


## 语料流：只记录，不参与任何判定（docs/13 隔离第 1 条）。
func speak(actor: int, text: String, visibility: int = 0, to: PackedInt32Array = PackedInt32Array()) -> void:
	var e = preload("res://core/match/match_event.gd").speech(actor, text, visibility)
	e.vis_list = to
	_commit(e)


func _commit(e) -> void:
	e.round = state.round
	e.nego = state.nego
	e.phase = state.phase
	log.append(e)
	if e.is_rule():
		template.reduce(state, e)
	for s in _sinks:
		s.on_event(e)
	if e.type == &"MatchEnded":
		for s in _sinks:
			s.on_match_end(e.payload)


func _pump() -> void:
	var guard := 0
	while not state.ended:
		var events: Array = template.advance(state, rng, facts)
		if events.is_empty():
			return
		for e in events:
			_commit(e)
		guard += 1
		assert(guard < PUMP_GUARD, "phase machine did not converge")


# —— 重放：只用规则事件流复算整局（docs/13 硬性验收）——

static func replay(p_template: RefCounted, p_seats: Array, events: Array) -> MatchState:
	var st := MatchStateCls.new()
	var typed: Array[SeatState] = []
	for s in p_seats:
		typed.append(s.clone() if s.has_method("clone") else s)
	st.seats = typed
	st.tpl = p_template.initial_state(typed)
	for e in events:
		if not e.is_rule():
			continue
		st.round = e.round
		st.nego = e.nego
		st.phase = e.phase
		p_template.reduce(st, e)
	return st
