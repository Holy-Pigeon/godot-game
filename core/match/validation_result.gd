class_name ValidationResult
extends RefCounted

var ok: bool = true
var reason: String = ""


static func accept() -> ValidationResult:
	return ValidationResult.new()


static func reject(p_reason: String) -> ValidationResult:
	var r := ValidationResult.new()
	r.ok = false
	r.reason = p_reason
	return r


func _to_string() -> String:
	return "OK" if ok else "REJECT(%s)" % reason
