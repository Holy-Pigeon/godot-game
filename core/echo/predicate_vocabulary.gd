class_name PredicateVocabulary
extends RefCounted

## 封闭的情境谓词词表（docs/04、docs/15 §5.1）。
## 不允许各模板自造谓词——一旦放开，词表会碎成每个模板一套方言，
## 回响的跨模板性当场归零。
##
## MVP 阶段本词表只被密令求值与兼容矩阵校验使用；回响引擎尚未接入。

const VERSION := 1

const P_PROMISE_BROKEN := &"promise_broken"
const P_DECISION_FAILED := &"decision_failed"
const P_BURDEN_TAKEN_FOR_ME := &"burden_taken_for_me"
const P_TRANSFER_REFUSED := &"transfer_refused"
const P_INBOUND_REQUEST_COUNT := &"inbound_request_count"
const P_BURDEN_COUNT := &"burden_count"
const P_LIFESPAN_QUANTILE := &"lifespan_quantile"
const P_STAGE_INDEX := &"stage_index"

const ALL: Array[StringName] = [
	P_PROMISE_BROKEN,
	P_DECISION_FAILED,
	P_BURDEN_TAKEN_FOR_ME,
	P_TRANSFER_REFUSED,
	P_INBOUND_REQUEST_COUNT,
	P_BURDEN_COUNT,
	P_LIFESPAN_QUANTILE,
	P_STAGE_INDEX,
]


static func exists(name: StringName) -> bool:
	return ALL.has(name)


## 模板绑定了哪些谓词 / 缺哪些。未绑定不是错误，是合法降级：
## 该关无法激活对应回响，且绝不让玩家为无效发动付费（docs/04）。
static func coverage(template) -> Dictionary:
	var bound: Array[StringName] = []
	var missing: Array[StringName] = []
	var bindings: Dictionary = template.predicate_bindings()
	for p in ALL:
		if bindings.has(p):
			bound.append(p)
		else:
			missing.append(p)
	return {"bound": bound, "missing": missing, "total": ALL.size()}
