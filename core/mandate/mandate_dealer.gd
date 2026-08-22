class_name MandateDealer
extends RefCounted

## 发令器。必须排除天然完成、完全重复或因目标状态不可能完成的组合（docs/12）。
## 抽取结果先写成事件，重放不重新 roll。

const MandateDefCls := preload("res://core/mandate/mandate_def.gd")


## 返回 [{seat, mandate_id, target}]，按座位号升序，保证确定性。
static func deal(pool: Array, seat_ids: Array, rng) -> Array:
	var by_diff := {
		MandateDefCls.LOW: [], MandateDefCls.MID: [], MandateDefCls.HIGH: [],
	}
	for m in pool:
		by_diff[m.difficulty].append(m)
	for k in by_diff:
		by_diff[k].sort_custom(func(a, b): return a.id < b.id)
		rng.shuffle(by_diff[k])

	# 固定抽取两条低、两条中、两条高；人数不为 6 时按难度轮转补齐
	var order: Array = [MandateDefCls.LOW, MandateDefCls.LOW,
		MandateDefCls.MID, MandateDefCls.MID,
		MandateDefCls.HIGH, MandateDefCls.HIGH]
	var chosen: Array = []
	var cursor := {MandateDefCls.LOW: 0, MandateDefCls.MID: 0, MandateDefCls.HIGH: 0}
	for i in range(seat_ids.size()):
		var diff: StringName = order[i % order.size()]
		var bucket: Array = by_diff[diff]
		if cursor[diff] >= bucket.size():
			cursor[diff] = 0
		chosen.append(bucket[cursor[diff]])
		cursor[diff] = cursor[diff] + 1

	var seats: Array = seat_ids.duplicate()
	seats.sort()
	rng.shuffle(chosen)

	var out: Array = []
	for i in range(seats.size()):
		var m = chosen[i]
		var target := -1
		if m.needs_target:
			target = _pick_target(seats, seats[i], rng)
		out.append({"seat": seats[i], "mandate_id": m.id, "target": target})
	return out


## 指向 X 的密令不能指向自己——这是唯一能静态判定的「不可能完成」组合。
static func _pick_target(seats: Array, me: int, rng) -> int:
	var candidates: Array = []
	for s in seats:
		if s != me:
			candidates.append(s)
	if candidates.is_empty():
		return -1
	return candidates[rng.range_int(0, candidates.size() - 1)]


static func index(pool: Array) -> Dictionary:
	var out := {}
	for m in pool:
		out[m.id] = m
	return out
