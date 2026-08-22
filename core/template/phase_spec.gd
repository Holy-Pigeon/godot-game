class_name PhaseSpec
extends RefCounted

## 阶段是数据，不是一串 match 分支。横向扩展关卡 = 换一张表。

var id: int = 0
var name: StringName = &""
var accepts: Array[StringName] = []   ## 本阶段接受的命令类型
var auto: bool = false                ## 无需命令，由 advance() 自动穿过


static func make(p_id: int, p_name: StringName, p_accepts: Array[StringName],
		p_auto: bool = false) -> PhaseSpec:
	var s := PhaseSpec.new()
	s.id = p_id
	s.name = p_name
	s.accepts = p_accepts
	s.auto = p_auto
	return s


func accepts_command(t: StringName) -> bool:
	return accepts.has(t)
