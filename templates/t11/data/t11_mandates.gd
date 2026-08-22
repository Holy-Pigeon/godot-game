class_name T11Mandates
extends RefCounted

## T-11 密令池（docs/12）。密令只决定个人收益，不暗示阵营。
## 低 / 中 / 高分别奖励 1 / 2 / 3 日；失败无奖励，也不额外扣除余命。

const MandateDefCls := preload("res://core/mandate/mandate_def.gd")

const TABLE: Array = [
	{"id": "M-01", "name": "【守住】", "difficulty": &"low", "needs_target": true,
		"summary": "X 活到关卡结束", "check": &"m01_keep_alive"},
	{"id": "M-02", "name": "【一起扛】", "difficulty": &"low", "needs_target": true,
		"summary": "至少一轮中我与 X 都结算了灾痕", "check": &"m02_settle_together"},
	{"id": "M-03", "name": "【松手】", "difficulty": &"low", "needs_target": true,
		"summary": "X 至少一次同意别人从他手中接走灾痕", "check": &"m03_let_go"},
	{"id": "M-04", "name": "【别碰他】", "difficulty": &"low", "needs_target": true,
		"summary": "X 整局累计结算不超过 3 枚灾痕", "check": &"m04_limit_target"},

	{"id": "M-05", "name": "【都给我】", "difficulty": &"mid",
		"summary": "至少一轮中我结算 2 枚灾痕并存活", "check": &"m05_double_burden"},
	{"id": "M-06", "name": "【拿回来】", "difficulty": &"mid", "needs_target": true,
		"summary": "X 同意我的转移申请，且该灾痕最终由我结算", "check": &"m06_take_from_target"},
	{"id": "M-07", "name": "【说话不算】", "difficulty": &"mid", "requires_cooperation": true,
		"summary": "公开承诺认可、最终投反对，且该协商轮被否决", "check": &"m07_broken_promise"},
	{"id": "M-08", "name": "【一份不留】", "difficulty": &"mid",
		"summary": "我曾持有灾痕，最终通过转移在结算时持有 0 枚", "check": &"m08_hands_clean"},

	{"id": "M-09", "name": "【四人共担】", "difficulty": &"high",
		"summary": "一次通过的方案中恰有 4 名玩家各结算 1 枚", "check": &"m09_four_way"},
	{"id": "M-10", "name": "【活得最少】", "difficulty": &"high",
		"summary": "活到结束且余命处于存活者后 1/3", "check": &"m10_lowest_third"},
	{"id": "M-11", "name": "【独自逆流】", "difficulty": &"high", "requires_cooperation": true,
		"summary": "某个通过的方案中，我是全场唯一投反对票的人", "check": &"m11_lone_dissent"},
	{"id": "M-12", "name": "【一次都不】", "difficulty": &"high",
		"summary": "活到结束，且每次通过的结算中我持有 0 枚灾痕", "check": &"m12_never_settled"},
]


static func pool() -> Array:
	var out: Array = []
	for d in TABLE:
		out.append(MandateDefCls.from_dict(d))
	return out
