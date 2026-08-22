class_name LevelTemplate
extends RefCounted

## 关卡模板抽象接口。MatchRuntime 只认这个接口。
## 架构验收标准：新增第二个模板不修改 core/ 下任何一个文件（docs/15 §4.2）。

const ValidationResultCls := preload("res://core/match/validation_result.gd")


# —— 本关玩法（与回响无关）——

func id() -> StringName:
	return &"UNDEFINED"


func player_range() -> Vector2i:
	return Vector2i(2, 16)


func phase_specs() -> Array:
	return []


## 确定性骨架，不得使用 rng；一切随机初始化都要走 begin() 发事件。
func initial_state(_seats: Array) -> RefCounted:
	return null


## 开局事件（含需要 rng 的抽取，结果写进载荷）
func begin(_state, _rng) -> Array:
	return []


func validate(_state, _cmd) -> ValidationResult:
	return ValidationResultCls.reject("template does not accept commands")


## 命令通过校验后产出的事实
func emit(_state, _cmd, _rng) -> Array:
	return []


## 纯函数：无 rng、无 IO、无时间
func reduce(_state, _event) -> void:
	pass


## 自动推进：返回空数组表示当前需要等待命令
func advance(_state, _rng) -> Array:
	return []


# —— 三张对外绑定表（docs/15 §4.3）——

## ① 抽象谓词 → 本关事件投影。可选、逐条；未绑定则依赖它的回响在本关不可激活。
func predicate_bindings() -> Dictionary:
	return {}


## ② 抽象锚点 → 本关效果动词。L1/L2 强制实现，否则不得上架。
func anchor_bindings() -> Dictionary:
	return {}


## ③ 本关损失事件 → 创伤 W1–W8。缺失则本关不产生渴望。
func trauma_bindings() -> Array:
	return []
