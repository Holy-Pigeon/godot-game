class_name T11Secret
extends RefCounted

## 内部潜规则层〔不得向玩家展示〕。只订阅事实，独立于主流程（docs/12）。
##
## 真正目标不是找到四个牺牲者，而是让每一份损失都经过自愿交接，
## 让最终方案成为所有人的共同决定。

const Ev := preload("res://core/match/match_event.gd")


## 一个关卡轮次同时满足四条件时，内部记为 1 个「共同决策轮」。
static func evaluate_round(state, alive_at_vote: Array, rejects: int,
		eliminated: Array) -> Array:
	var t = state.tpl

	# 1 · 本轮最终由全体存活玩家一致投认可票；只达到 n−1 不计
	if rejects != 0:
		return []
	# 2 · 4 枚灾痕在结算前都至少发生过一次玩家间移动
	if not t.all_moved():
		return []
	# 3 · 每名存活玩家本轮至少参与过一次承担过程
	for s in alive_at_vote:
		if not t.lamps.has(s):
			return []
	# 4 · 本轮没有玩家因灾痕结算而失守
	if not eliminated.is_empty():
		return []

	return [
		Ev.make(&"JointRound", Ev.NO_ACTOR,
			{"round": state.round, "k": t.joint_rounds + 1}, Ev.VIS_SERVER),
		# 门环转动对玩家可见，但不显示计数和含义
		Ev.make(&"RingAdvanced", Ev.NO_ACTOR, {"ring": t.ring + 1}),
	]
