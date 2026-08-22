class_name StateSnapshot
extends RefCounted

## 状态哈希：重放断言与 GM 快照双重用途（docs/15 §9）。

const FNV_OFFSET := -0x340D631B7BDDDCDB  # 0xCBF29CE484222325
const FNV_PRIME := 0x100000001B3


static func hash_text(text: String) -> int:
	var h := FNV_OFFSET
	for b in text.to_utf8_buffer():
		h = (h ^ b) * FNV_PRIME
	return h


static func of_state(state) -> int:
	return hash_text(state.canonical())


static func of_log(log_ref, rule_only: bool = true) -> int:
	return hash_text(log_ref.digest(rule_only))


static func fingerprint(state, log_ref) -> Dictionary:
	return {
		"state": of_state(state),
		"rule_stream": of_log(log_ref, true),
		"events": log_ref.rule_events().size(),
	}
