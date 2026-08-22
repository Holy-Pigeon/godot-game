class_name SeatState
extends RefCounted

## 一个编号在本局中的通用状态。余命是平台级概念，不属于任何模板。

var id: int = 0
var lifespan: int = 0
var entry_lifespan: int = 0
var alive: bool = true


static func make(p_id: int, p_lifespan: int) -> SeatState:
	var s := SeatState.new()
	s.id = p_id
	s.lifespan = p_lifespan
	s.entry_lifespan = p_lifespan
	return s


func clone() -> SeatState:
	var s := SeatState.new()
	s.id = id
	s.lifespan = lifespan
	s.entry_lifespan = entry_lifespan
	s.alive = alive
	return s


func canonical() -> String:
	return "seat%d:lp=%d,entry=%d,alive=%d" % [id, lifespan, entry_lifespan, 1 if alive else 0]
