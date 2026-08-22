class_name MatchCommand
extends RefCounted

## 玩家或 GM 的意图。命令可以被拒绝，且永远不直接改变状态。

var type: StringName = &""
var actor: int = -1
var args: Dictionary = {}
var gm_origin: bool = false


static func make(p_type: StringName, p_actor: int, p_args: Dictionary = {}) -> MatchCommand:
	var c := MatchCommand.new()
	c.type = p_type
	c.actor = p_actor
	c.args = p_args
	return c


func arg(key: String, fallback: Variant = null) -> Variant:
	return args.get(key, fallback)


func _to_string() -> String:
	return "%s(actor=%d,%s)" % [String(type), actor, str(args)]
