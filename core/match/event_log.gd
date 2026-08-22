class_name EventLog
extends RefCounted

## 追加式事件日志。两条流共用同一条单调递增的序号轴，但物理上分开存放，
## 于是「删掉行为语料流」在文件层面就是删一个文件（docs/13）。

const MatchEventCls := preload("res://core/match/match_event.gd")

var _all: Array[MatchEvent] = []
var _rule: Array[MatchEvent] = []
var _corpus: Array[MatchEvent] = []
var _next_seq: int = 1
var _clock_ms: int = 0


func append(e: MatchEvent) -> MatchEvent:
	e.seq = _next_seq
	_next_seq += 1
	if e.t_ms == 0:
		_clock_ms += 1
		e.t_ms = _clock_ms
	_all.append(e)
	if e.is_rule():
		_rule.append(e)
	else:
		_corpus.append(e)
	return e


func all_events() -> Array[MatchEvent]:
	return _all


## 复算只允许使用规则事件流（docs/10、docs/13）。
func rule_events() -> Array[MatchEvent]:
	return _rule


func corpus_events() -> Array[MatchEvent]:
	return _corpus


func size() -> int:
	return _all.size()


## 按序号窗口取事件：一句话的含义取决于它前后的规则事件（docs/13）。
func window(from_seq: int, to_seq: int) -> Array[MatchEvent]:
	var out: Array[MatchEvent] = []
	for e in _all:
		if e.seq >= from_seq and e.seq <= to_seq:
			out.append(e)
	return out


func of_type(t: StringName) -> Array[MatchEvent]:
	var out: Array[MatchEvent] = []
	for e in _rule:
		if e.type == t:
			out.append(e)
	return out


func last_of_type(t: StringName) -> MatchEvent:
	for i in range(_rule.size() - 1, -1, -1):
		if _rule[i].type == t:
			return _rule[i]
	return null


func digest(rule_only: bool = true) -> String:
	var src := _rule if rule_only else _all
	var acc := ""
	for e in src:
		acc += e.canonical() + "\n"
	return acc
