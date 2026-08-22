class_name AnchorRegistry
extends RefCounted

## 已冻结的 L1/L2 抽象锚点集（docs/04）。锚点是全体上架模板的强制义务，
## 因此必须小而通用；新增锚点是平台级决策，不随单条回响的需要扩张。
##
## MVP：注册表存在但为空，can_apply 恒假。这一块加上阶段 4/6b 与 cause 字段，
## 决定了接入回响时是「加模块」还是「重构状态机」。

const A_REVEAL_LOCKED_CHOICE := &"揭示·一次已锁定的选择·L1"
const A_REPLAY_MY_STATEMENT := &"重播·我的一次公开表态·L1"
const A_SHIFT_ONTO_ME := &"转嫁·一次针对我的判定后果·L2"
const A_SHIFT_ONTO_TARGET := &"转嫁·我的一次判定后果到指定编号·L2"

const REQUIRED: Array[StringName] = [
	A_REVEAL_LOCKED_CHOICE,
	A_REPLAY_MY_STATEMENT,
	A_SHIFT_ONTO_ME,
	A_SHIFT_ONTO_TARGET,
]

var _handlers: Dictionary = {}


func register(anchor: StringName, handler: Callable) -> void:
	assert(REQUIRED.has(anchor), "unknown anchor: %s" % anchor)
	_handlers[anchor] = handler


func can_apply(anchor: StringName) -> bool:
	return _handlers.has(anchor)


func apply(anchor: StringName, ctx: Dictionary) -> Array:
	if not can_apply(anchor):
		return []
	return _handlers[anchor].call(ctx)


## 上架判据：L1/L2 必须全实现，否则不得上架（docs/04）。
static func admission(template) -> Dictionary:
	var bindings: Dictionary = template.anchor_bindings()
	var missing: Array[StringName] = []
	for a in REQUIRED:
		if not bindings.has(a):
			missing.append(a)
	return {
		"implemented": REQUIRED.size() - missing.size(),
		"required": REQUIRED.size(),
		"missing": missing,
		"admissible": missing.is_empty(),
	}
