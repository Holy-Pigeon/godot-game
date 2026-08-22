class_name MandateDef
extends RefCounted

## 密令定义。分配、难度、奖励、目标与判定入口全部是数据；
## 新增一条复用已有判定原语的密令 = 纯数据，不碰代码（docs/15 §3.6）。

const LOW := &"low"
const MID := &"mid"
const HIGH := &"high"

const REWARD := {LOW: 1, MID: 2, HIGH: 3}

var id: String = ""
var name: String = ""
var difficulty: StringName = LOW
var summary: String = ""
var needs_target: bool = false

## 达成需要他人配合。M-07 需要第二张反对票才能构成正式否决，
## M-11 需要其余所有人都投认可——单人都无法独立完成（docs/15 §3.6）。
var requires_cooperation: bool = false

## 判定原语名，由模板的 mandate_checks 绑定层实现
var check: StringName = &""

## 密令类别 → 创伤映射尚未定案（docs/14 未决项），MVP 留空
var trauma: StringName = &""


static func from_dict(d: Dictionary) -> MandateDef:
	var m := MandateDef.new()
	m.id = d["id"]
	m.name = d["name"]
	m.difficulty = d["difficulty"]
	m.summary = d.get("summary", "")
	m.needs_target = d.get("needs_target", false)
	m.requires_cooperation = d.get("requires_cooperation", false)
	m.check = d["check"]
	m.trauma = d.get("trauma", &"")
	return m


func reward() -> int:
	return REWARD[difficulty]


func _to_string() -> String:
	return "%s%s" % [id, name]
