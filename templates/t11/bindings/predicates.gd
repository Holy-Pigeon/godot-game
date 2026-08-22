class_name T11PredicateBindings
extends RefCounted

## 绑定表 ①：抽象谓词 → T-11 事件投影（docs/15 §5.2）。
##
## 回响与密令只会说抽象语；"灾痕"这个词只出现在这一层里面。
## 换成拍卖关时，同一批函数名会用完全不同的事件实现。

const Vocab := preload("res://core/echo/predicate_vocabulary.gd")


func table() -> Dictionary:
	return {
		Vocab.P_PROMISE_BROKEN: Callable(self, "promise_broken"),
		Vocab.P_DECISION_FAILED: Callable(self, "decision_failed"),
		Vocab.P_BURDEN_TAKEN_FOR_ME: Callable(self, "burden_taken_for_me"),
		Vocab.P_TRANSFER_REFUSED: Callable(self, "transfer_refused"),
		Vocab.P_INBOUND_REQUEST_COUNT: Callable(self, "inbound_request_count"),
		Vocab.P_BURDEN_COUNT: Callable(self, "burden_count"),
		Vocab.P_LIFESPAN_QUANTILE: Callable(self, "lifespan_quantile"),
		Vocab.P_STAGE_INDEX: Callable(self, "stage_index"),
	}


## 公开表态与最终选择相反：x 公开承诺认可后投了反对票。
## 只读结构化的 PromiseApprove 事件——聊天框里说"我认可"永远不能进判定。
func promise_broken(facts, args: Dictionary) -> bool:
	var x: int = args.get("x", -1)
	var promised := {}
	for e in facts.events():
		match e.type:
			&"NegoStarted":
				promised = {}
			&"PromiseApprove":
				promised[e.actor] = true
			&"VotesRevealed":
				var votes: Dictionary = e.payload["votes"]
				if promised.has(x) and votes.has(x) and not votes[x]:
					return true
	return false


## 集体决议未通过（含被否决与恩典延期以外的一切未通过）
func decision_failed(facts, args: Dictionary) -> bool:
	var window: String = args.get("window", "any")
	var vetoes: Array = facts.of_type(&"ProposalVetoed")
	if window == "any":
		return not vetoes.is_empty()
	var r: int = args.get("round", facts.last_round())
	for e in vetoes:
		if e.round == r:
			return true
	return false


## x 承接并实际结算了本应落在我身上的代价：
## x 申请接手我持有的灾痕 → 我同意 → 最终由 x 结算。
func burden_taken_for_me(facts, args: Dictionary) -> bool:
	var x: int = args.get("x", -1)
	var me: int = args.get("me", -1)
	var handed := {}   # disaster -> true，本轮内由 me 交给 x
	for e in facts.events():
		match e.type:
			&"DisastersSpawned":
				handed = {}
			&"TransferResponded":
				if e.payload["accept"] and e.payload["requester"] == x \
						and e.payload["target"] == me:
					handed[e.payload["disaster"]] = true
			&"LossSettled":
				if e.actor == x and not handed.is_empty():
					return true
	return false


## 一次转让请求被拒
func transfer_refused(facts, args: Dictionary) -> bool:
	var to_seat: int = args.get("to", -1)      ## 被拒绝的申请者
	var by_seat: int = args.get("by", -1)      ## 拒绝者，-1 表示任意
	var window: String = args.get("window", "any")
	var r: int = args.get("round", facts.last_round())
	for e in facts.of_type(&"TransferResponded"):
		if e.payload["accept"]:
			continue
		if to_seat != -1 and e.payload["requester"] != to_seat:
			continue
		if by_seat != -1 and e.payload["target"] != by_seat:
			continue
		if window == "last_round" and e.round != r:
			continue
		return true
	return false


## 他人向我发起的转让请求数
func inbound_request_count(facts, args: Dictionary) -> int:
	var me: int = args.get("me", -1)
	var window: String = args.get("window", "any")
	var r: int = args.get("round", facts.last_round())
	var n := 0
	for e in facts.of_type(&"TransferRequested"):
		if e.payload["target"] != me:
			continue
		if window == "last_round" and e.round != r:
			continue
		n += 1
	return n


## 当前承担的代价单位数 = 当前持有灾痕数
func burden_count(facts, args: Dictionary) -> int:
	var subject: int = args.get("subject", -1)
	var held := {}
	for e in facts.events():
		match e.type:
			&"DisastersSpawned":
				held = {}
			&"DisasterClaimed":
				held[e.payload["disaster"]] = e.actor
			&"TransferResponded":
				if e.payload["accept"]:
					held[e.payload["disaster"]] = e.payload["requester"]
	var n := 0
	for d in held:
		if held[d] == subject:
			n += 1
	return n


## 余命分位：存活者中从低到高的位置，返回百分位整数 1..100
func lifespan_quantile(facts, args: Dictionary) -> int:
	var subject: int = args.get("subject", -1)
	var lifespans := {}
	var dead := {}
	for e in facts.events():
		match e.type:
			&"MatchStarted":
				var ids: Array = e.payload["seats"]
				var lps: Array = e.payload["lifespans"]
				for i in range(ids.size()):
					lifespans[ids[i]] = lps[i]
			&"LossSettled":
				lifespans[e.actor] = e.payload["lifespan_after"]
			&"FinalAward", &"PerfectRefund":
				lifespans[e.actor] = int(lifespans.get(e.actor, 0)) + e.payload["amount"]
			&"PlayerEliminated":
				dead[e.actor] = true
	if not lifespans.has(subject) or dead.has(subject):
		return -1
	var alive_values: Array = []
	for s in lifespans:
		if not dead.has(s):
			alive_values.append(lifespans[s])
	alive_values.sort()
	var below := 0
	for v in alive_values:
		if v < lifespans[subject]:
			below += 1
	if alive_values.is_empty():
		return -1
	return int((below * 100) / alive_values.size()) + 1


## 当前强度档 = 当前幕
func stage_index(facts, _args: Dictionary) -> int:
	var last: Array = facts.of_type(&"RoundStarted")
	if last.is_empty():
		return 0
	return last[last.size() - 1].payload["act"]
