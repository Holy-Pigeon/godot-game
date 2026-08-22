class_name FactProvider
extends RefCounted

## 对规则事件流的只读投影查询。
## 密令的达成条件与回响的激活条件本质是同一种东西，共用这一层（docs/15 §5.4）。
##
## 纪律：只读规则事件流，不读语料流、不读推断结果（docs/13 隔离第 1 条）。

var _events: Array = []


func _init(rule_events: Array) -> void:
	for e in rule_events:
		if e.is_rule():
			_events.append(e)


func events() -> Array:
	return _events


func of_type(t: StringName) -> Array:
	var out: Array = []
	for e in _events:
		if e.type == t:
			out.append(e)
	return out


func in_round(round_no: int) -> Array:
	var out: Array = []
	for e in _events:
		if e.round == round_no:
			out.append(e)
	return out


func in_nego(round_no: int, nego_no: int) -> Array:
	var out: Array = []
	for e in _events:
		if e.round == round_no and e.nego == nego_no:
			out.append(e)
	return out


func last_round() -> int:
	var r := 0
	for e in _events:
		r = maxi(r, e.round)
	return r
