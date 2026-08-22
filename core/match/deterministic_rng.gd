class_name DeterministicRng
extends RefCounted

## splitmix64。随机只有一个来源，且任何一次抽取的结果都必须先写成事件——
## 重放时不重新 roll，只读事件里的结果（docs/15 §2.3）。

const GAMMA := -0x61C8864680B583EB  # 0x9E3779B97F4A7C15 的补码写法

var _s: int = 0
var _draws: int = 0


func _init(seed_value: int = 0) -> void:
	_s = seed_value


func draws() -> int:
	return _draws


static func _ushr(v: int, n: int) -> int:
	if n <= 0:
		return v
	return (v >> n) & ((1 << (64 - n)) - 1)


func next_u64() -> int:
	_draws += 1
	_s = _s + GAMMA
	var z := _s
	z = (z ^ _ushr(z, 30)) * -0x40A7B892E31B1A47  # 0xBF58476D1CE4E5B9
	z = (z ^ _ushr(z, 27)) * -0x6B2FB644ECCEEE15  # 0x94D049BB133111EB
	return z ^ _ushr(z, 31)


func next_nonneg() -> int:
	var v := next_u64()
	return v if v >= 0 else -(v + 1)


## 闭区间 [lo, hi]
func range_int(lo: int, hi: int) -> int:
	if hi <= lo:
		return lo
	return lo + (next_nonneg() % (hi - lo + 1))


## 返回 1..100 的整数，用于百分比判定（避免浮点进入内核）
func percent() -> int:
	return range_int(1, 100)


func pick(arr: Array) -> Variant:
	if arr.is_empty():
		return null
	return arr[range_int(0, arr.size() - 1)]


## 原地 Fisher-Yates，顺序完全由种子决定
func shuffle(arr: Array) -> void:
	for i in range(arr.size() - 1, 0, -1):
		var j := range_int(0, i)
		var tmp: Variant = arr[i]
		arr[i] = arr[j]
		arr[j] = tmp
