class_name EchoCompatibility
extends RefCounted

## 回响 × 模板兼容矩阵校验（docs/15 §4.5）。
## 两条判读规则：
##   - 未绑定谓词不是错误，是合法降级：该关无法激活该回响，且不产生任何消耗。
##   - 无任何模板绑定的谓词 = 永远不会激活的回响，必须被报出来。

const Vocab := preload("res://core/echo/predicate_vocabulary.gd")
const Anchors := preload("res://core/echo/anchor_registry.gd")


static func report(templates: Array, echoes: Array = []) -> Dictionary:
	var per_template: Array = []
	var bound_anywhere: Dictionary = {}

	for t in templates:
		var cov: Dictionary = Vocab.coverage(t)
		var adm: Dictionary = Anchors.admission(t)
		for p in cov["bound"]:
			bound_anywhere[p] = true
		per_template.append({
			"template": String(t.id()),
			"anchors": "%d/%d" % [adm["implemented"], adm["required"]],
			"admissible": adm["admissible"],
			"predicates": "%d/%d" % [(cov["bound"] as Array).size(), cov["total"]],
			"missing_predicates": cov["missing"],
		})

	var dead: Array = []
	for e in echoes:
		var needed: Array = e.get("predicates", [])
		for p in needed:
			if not bound_anywhere.has(p):
				dead.append({"echo": e.get("id", "?"), "predicate": p})

	return {"templates": per_template, "dead_entries": dead}


static func format(rep: Dictionary) -> String:
	var lines := PackedStringArray()
	for row in rep["templates"]:
		lines.append("%-10s 锚点 %s %s   谓词 %s" % [
			row["template"], row["anchors"],
			"✓ 可上架" if row["admissible"] else "✗ 不得上架",
			row["predicates"],
		])
		if not (row["missing_predicates"] as Array).is_empty():
			var names := PackedStringArray()
			for p in row["missing_predicates"]:
				names.append(String(p))
			lines.append("           未绑定：" + ", ".join(names))
	for d in rep["dead_entries"]:
		lines.append("⚠ %s 引用谓词 %s，无任何上架模板绑定 → 死条目" % [d["echo"], d["predicate"]])
	return "\n".join(lines)
