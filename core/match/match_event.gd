class_name MatchEvent
extends RefCounted

## 一条已经发生的事实。事件是改变状态的唯一途径，永远不会被拒绝。
## 结构对齐 docs/13-record-and-inference.md 的记录格式：
##   序号 · 时间戳 · 关卡轮次 · 协商轮 · 阶段编号 · 行动者 · 类型 · 载荷

enum { STREAM_RULE = 0, STREAM_CORPUS = 1 }
enum { VIS_PUBLIC = 0, VIS_ACTOR = 1, VIS_LIST = 2, VIS_SERVER = 3 }

## 持有者变更的来源。MVP 恒为 CAUSE_VOLUNTARY，但字段现在就要有：
## 回响强制移动不点亮自愿参与灯（docs/12 世界内线索）。
enum { CAUSE_VOLUNTARY = 0, CAUSE_ECHO = 1 }

const NO_ACTOR := -1

var seq: int = 0
var t_ms: int = 0
var round: int = 0
var nego: int = 0
var phase: int = 0
var actor: int = NO_ACTOR
var type: StringName = &""
var payload: Dictionary = {}
var stream: int = STREAM_RULE
var visibility: int = VIS_PUBLIC
var vis_list: PackedInt32Array = PackedInt32Array()
var gm_origin: bool = false


static func make(p_type: StringName, p_actor: int = NO_ACTOR,
		p_payload: Dictionary = {}, p_visibility: int = VIS_PUBLIC) -> MatchEvent:
	var e := MatchEvent.new()
	e.type = p_type
	e.actor = p_actor
	e.payload = p_payload
	e.visibility = p_visibility
	return e


static func speech(p_actor: int, p_text: String, p_visibility: int = VIS_PUBLIC) -> MatchEvent:
	var e := MatchEvent.make(&"Speech", p_actor, {"text": p_text}, p_visibility)
	e.stream = STREAM_CORPUS
	return e


func is_rule() -> bool:
	return stream == STREAM_RULE


## 规范化文本形式，用于快照哈希与黄金重放断言。
func canonical() -> String:
	var keys := payload.keys()
	keys.sort()
	var parts := PackedStringArray()
	for k in keys:
		parts.append("%s=%s" % [str(k), _canon_value(payload[k])])
	return "%d|%d|%d|%d|%d|%s|%s" % [
		round, nego, phase, actor, stream, String(type), ";".join(parts)
	]


static func _canon_value(v: Variant) -> String:
	match typeof(v):
		TYPE_ARRAY:
			var out := PackedStringArray()
			for item in v:
				out.append(_canon_value(item))
			return "[" + ",".join(out) + "]"
		TYPE_DICTIONARY:
			var dkeys := (v as Dictionary).keys()
			dkeys.sort()
			var dout := PackedStringArray()
			for k in dkeys:
				dout.append("%s:%s" % [str(k), _canon_value(v[k])])
			return "{" + ",".join(dout) + "}"
		TYPE_BOOL:
			return "1" if v else "0"
		_:
			return str(v)
