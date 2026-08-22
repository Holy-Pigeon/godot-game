class_name FactProvider
extends RefCounted

## 对规则事件流的只读投影查询。
## 密令的达成条件与回响的激活条件本质是同一种东西，共用这一层（docs/15 §5.4）。
##
## 纪律：只读规则事件流，不读语料流、不读推断结果（docs/13 隔离第 1 条）。

## 直接引用 EventLog，构造为 O(1)：投影查询在批量模拟里会被反复调用，
## 每次拷贝一份事件数组会把 200 局模拟拖成二次复杂度。
var _log = null
var _static: Array = []


func _init(source) -> void:
	if source is Array:
		for e in source:
			if e.is_rule():
				_static.append(e)
	else:
		_log = source


func events() -> Array:
	return _log.rule_events() if _log != null else _static


func of_type(t: StringName) -> Array:
	var out: Array = []
	for e in events():
		if e.type == t:
			out.append(e)
	return out


func in_round(round_no: int) -> Array:
	var out: Array = []
	for e in events():
		if e.round == round_no:
			out.append(e)
	return out


func in_nego(round_no: int, nego_no: int) -> Array:
	var out: Array = []
	for e in events():
		if e.round == round_no and e.nego == nego_no:
			out.append(e)
	return out


func last_round() -> int:
	var r := 0
	for e in events():
		r = maxi(r, e.round)
	return r
