class_name T11State
extends RefCounted

## T-11 模板专属状态。
## 可推导的量不进状态（act / base_loss 由 round 与本轮否决数推出），
## 避免重放时两处不同步（docs/15 §3.3）。

# —— 本关卡轮次 ——
var disasters: Array = []            ## [{id, holder, moved}]，holder = -1 表示无人承担
var vetoes_this_round: int = 0
var lamps: Dictionary = {}           ## seat -> true，本轮参与灯，轮末清空
var pulsed: bool = false             ## 本轮是否已出现环形脉冲

# —— 本协商轮 ——
var turn_order: Array[int] = []
var turn_idx: int = 0
var acted: Dictionary = {}           ## seat -> true
var pending: Dictionary = {}         ## {} 或 {requester, target, disaster}
var promises: Dictionary = {}        ## seat -> true，公开承诺认可
var ready: Dictionary = {}           ## seat -> true，自由交流就绪
var votes: Dictionary = {}           ## seat -> bool
var first_actor: int = 0

# —— 整局 ——
var veto_total: int = 0              ## F
var burden: Dictionary = {}          ## seat -> 累计承担值
var settled_count: Dictionary = {}   ## seat -> 累计结算灾痕枚数
var total_loss: Dictionary = {}      ## seat -> 累计实际被扣余命（完美通关返还用）
var joint_rounds: int = 0            ## K
var ring: int = 0
var mandates: Dictionary = {}        ## seat -> {mandate_id, target}
var mandate_reward: Dictionary = {}  ## seat -> 实际发放的密令奖
var pending_end_reason: StringName = &""
var end_reason: StringName = &""
var perfect_eval: StringName = &""
var perfect_success: bool = false


func holdings(seat: int) -> int:
	var n := 0
	for d in disasters:
		if d["holder"] == seat:
			n += 1
	return n


func held_by(seat: int) -> Array[int]:
	var out: Array[int] = []
	for d in disasters:
		if d["holder"] == seat:
			out.append(d["id"])
	return out


func disaster(did: int) -> Dictionary:
	for d in disasters:
		if d["id"] == did:
			return d
	return {}


func unclaimed() -> Array[int]:
	var out: Array[int] = []
	for d in disasters:
		if d["holder"] == -1:
			out.append(d["id"])
	return out


func all_allocated() -> bool:
	for d in disasters:
		if d["holder"] == -1:
			return false
	return true


func all_moved() -> bool:
	for d in disasters:
		if not d["moved"]:
			return false
	return true


func current_seat() -> int:
	if turn_idx < 0 or turn_idx >= turn_order.size():
		return -1
	return turn_order[turn_idx]


func base_loss(round_no: int, cfg) -> int:
	return cfg.base_loss_of_round(round_no) + vetoes_this_round


static func _canon_dict(d: Dictionary) -> String:
	var keys := d.keys()
	keys.sort()
	var parts := PackedStringArray()
	for k in keys:
		var v: Variant = d[k]
		parts.append("%s=%s" % [str(k), ("1" if v else "0") if typeof(v) == TYPE_BOOL else str(v)])
	return ",".join(parts)


func canonical() -> String:
	var ds := PackedStringArray()
	for d in disasters:
		ds.append("d%d:h=%d,m=%d" % [d["id"], d["holder"], 1 if d["moved"] else 0])
	var ms := PackedStringArray()
	var mkeys := mandates.keys()
	mkeys.sort()
	for k in mkeys:
		ms.append("%s=%s>%s" % [str(k), mandates[k]["mandate_id"], str(mandates[k]["target"])])
	return "D[%s] vr=%d vt=%d K=%d ring=%d burden{%s} settled{%s} loss{%s} lamps{%s} votes{%s} M[%s] MR{%s} end=%s pe=%s/%d" % [
		";".join(ds), vetoes_this_round, veto_total, joint_rounds, ring,
		_canon_dict(burden), _canon_dict(settled_count), _canon_dict(total_loss),
		_canon_dict(lamps), _canon_dict(votes),
		";".join(ms), _canon_dict(mandate_reward),
		String(end_reason), String(perfect_eval), 1 if perfect_success else 0,
	]
