class_name MatchState
extends RefCounted

## 纯数据容器。只有 Reducer 允许写它；任何绕过 命令→事件→归约 的写入都是 bug。

const SeatStateCls := preload("res://core/match/seat_state.gd")

var seats: Array[SeatState] = []
var round: int = 0
var nego: int = 0
var phase: int = 0
var started: bool = false
var ended: bool = false

## 模板专属状态（例如 T11State）。内核不理解它的内部结构，
## 只要求它提供 canonical() 用于快照哈希。
var tpl: RefCounted = null


func seat(id: int) -> SeatState:
	for s in seats:
		if s.id == id:
			return s
	return null


func alive_seats() -> Array[int]:
	var out: Array[int] = []
	for s in seats:
		if s.alive:
			out.append(s.id)
	return out


func alive_count() -> int:
	var n := 0
	for s in seats:
		if s.alive:
			n += 1
	return n


func seat_count() -> int:
	return seats.size()


func canonical() -> String:
	var parts := PackedStringArray()
	parts.append("r=%d,n=%d,ph=%d,end=%d" % [round, nego, phase, 1 if ended else 0])
	for s in seats:
		parts.append(s.canonical())
	if tpl != null and tpl.has_method("canonical"):
		parts.append(tpl.call("canonical"))
	return "|".join(parts)
