class_name T11Config
extends RefCounted

## T-11「最后提案」入场公示与参数（docs/12）。全部为整数日，内核禁止浮点。

var seat_count: int = 6
var rounds: int = 6
var disasters_per_round: int = 4
var max_hold: int = 2
var ticket: int = 2
var start_lifespan: int = 20          ## 支付门票后带入的真实余命（测试用默认值）
var act_base_loss: Array[int] = [1, 2, 3]   ## 三幕：第 1–2 / 3–4 / 5–6 轮
var award_first: int = 14
var award_second: int = 8
var veto_award_bonus: int = 1         ## 每次否决使第一、第二名各 +1
var perfect_bonus: int = 1
var early_end_alive: int = 2          ## 场上只剩两人时提前结束

## K → 完美通关概率（百分比整数），docs/12
var perfect_table: Array[int] = [0, 0, 0, 25, 50, 75, 100]


static func make_default() -> T11Config:
	return T11Config.new()


func act_of_round(r: int) -> int:
	return clampi((r + 1) / 2, 1, act_base_loss.size())


func base_loss_of_round(r: int) -> int:
	return act_base_loss[act_of_round(r) - 1]


func perfect_percent(k: int) -> int:
	if k < 0:
		return 0
	if k >= perfect_table.size():
		return perfect_table[perfect_table.size() - 1]
	return perfect_table[k]
