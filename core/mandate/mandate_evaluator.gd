class_name MandateEvaluator
extends RefCounted

## 局末一次性求值。只读规则事件流的投影，因此天然可复算；
## 新增密令不改核心（docs/15 §3.6）。
##
## 每条判定必须返回引用了具体事件序号的证据：
## 这既是 docs/13「证据强制引用」，也是渴望四因子里「一致性系数」的输入。

static func resolve(facts, assignments: Array, pool_index: Dictionary, checks) -> Array:
	var digest: Dictionary = checks.build_digest(facts)
	var out: Array = []
	for a in assignments:
		var m = pool_index.get(a["mandate_id"], null)
		if m == null:
			continue
		var verdict: Dictionary = checks.call(m.check, digest, a["seat"], a["target"])
		out.append({
			"seat": a["seat"],
			"mandate_id": m.id,
			"name": m.name,
			"difficulty": String(m.difficulty),
			"target": a["target"],
			"success": verdict["success"],
			"reward": m.reward() if verdict["success"] else 0,
			"evidence": verdict.get("evidence", []),
			"requires_cooperation": m.requires_cooperation,
		})
	return out
