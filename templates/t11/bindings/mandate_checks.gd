class_name T11MandateChecks
extends RefCounted

## T-11 密令判定原语。
##
## 与谓词词表同构的取舍：密令表本身是数据（id / 难度 / 目标 / 配合标记 / 判定名），
## 复用已有原语的新密令 = 纯数据；只有真正的新条件才需要在这里加一个函数。
##
## 纪律：只读规则事件流；每条判定都要返回引用了具体事件序号的证据。

# ————————————————————————— 一次性摘要 —————————————————————————

func build_digest(facts) -> Dictionary:
	var d := {
		"seats": [], "entry": {}, "final_lifespan": {}, "alive": {},
		"passes": [], "negos": [], "transfers": [],
		"held_in_round": {}, "settled_total": {}, "last_seq": 0,
	}
	var cur_round := 0
	var cur_nego := 0
	var holders := {}
	var promises := {}
	var last_votes := {}
	var last_rejects := 0
	var cur_pass = null

	for e in facts.events():
		d["last_seq"] = e.seq
		match e.type:
			&"MatchStarted":
				var ids: Array = e.payload["seats"]
				var lps: Array = e.payload["lifespans"]
				for i in range(ids.size()):
					d["seats"].append(ids[i])
					d["entry"][ids[i]] = lps[i]
					d["final_lifespan"][ids[i]] = lps[i]
					d["alive"][ids[i]] = true
					d["settled_total"][ids[i]] = 0
			&"RoundStarted":
				cur_round = e.payload["round"]
				d["held_in_round"][cur_round] = {}
				cur_pass = null
			&"DisastersSpawned":
				holders = {}
				for did in e.payload["ids"]:
					holders[did] = -1
			&"NegoStarted":
				cur_nego = e.payload["nego"]
				promises = {}
			&"PromiseApprove":
				promises[e.actor] = e.seq
			&"DisasterClaimed":
				holders[e.payload["disaster"]] = e.actor
				d["held_in_round"][cur_round][e.actor] = true
			&"TransferResponded":
				d["transfers"].append({
					"seq": e.seq, "round": cur_round,
					"requester": e.payload["requester"], "target": e.payload["target"],
					"disaster": e.payload["disaster"], "accept": e.payload["accept"],
				})
				if e.payload["accept"]:
					holders[e.payload["disaster"]] = e.payload["requester"]
					d["held_in_round"][cur_round][e.payload["requester"]] = true
			&"VotesRevealed":
				last_votes = e.payload["votes"]
				last_rejects = e.payload["rejects"]
			&"ProposalVetoed":
				d["negos"].append({
					"round": cur_round, "nego": cur_nego, "vetoed": true, "seq": e.seq,
					"promises": promises.duplicate(), "votes": last_votes.duplicate(),
					"rejects": last_rejects,
				})
			&"GraceExtension":
				d["negos"].append({
					"round": cur_round, "nego": cur_nego, "vetoed": false, "seq": e.seq,
					"promises": promises.duplicate(), "votes": last_votes.duplicate(),
					"rejects": last_rejects,
				})
			&"ProposalPassed":
				cur_pass = {
					"round": cur_round, "seq": e.seq, "holders": holders.duplicate(),
					"votes": last_votes.duplicate(), "rejects": last_rejects, "settled": {},
				}
				d["passes"].append(cur_pass)
				d["negos"].append({
					"round": cur_round, "nego": cur_nego, "vetoed": false, "seq": e.seq,
					"promises": promises.duplicate(), "votes": last_votes.duplicate(),
					"rejects": last_rejects,
				})
			&"LossSettled":
				if cur_pass != null:
					cur_pass["settled"][e.actor] = {
						"count": e.payload["count"], "seq": e.seq,
						"after": e.payload["lifespan_after"],
					}
				d["settled_total"][e.actor] = int(d["settled_total"].get(e.actor, 0)) + e.payload["count"]
				d["final_lifespan"][e.actor] = e.payload["lifespan_after"]
			&"PlayerEliminated":
				d["alive"][e.actor] = false
			&"FinalAward":
				d["final_lifespan"][e.actor] = int(d["final_lifespan"][e.actor]) + e.payload["amount"]
	return d


static func _ok(evidence: Array) -> Dictionary:
	return {"success": true, "evidence": evidence}


static func _no() -> Dictionary:
	return {"success": false, "evidence": []}


# ————————————————————————— 低难度 —————————————————————————

func m01_keep_alive(d: Dictionary, _me: int, x: int) -> Dictionary:
	if bool(d["alive"].get(x, false)):
		return _ok([d["last_seq"]])
	return _no()


func m02_settle_together(d: Dictionary, me: int, x: int) -> Dictionary:
	for p in d["passes"]:
		if p["settled"].has(me) and p["settled"].has(x):
			return _ok([p["settled"][me]["seq"], p["settled"][x]["seq"]])
	return _no()


func m03_let_go(d: Dictionary, _me: int, x: int) -> Dictionary:
	for t in d["transfers"]:
		if t["accept"] and t["target"] == x:
			return _ok([t["seq"]])
	return _no()


func m04_limit_target(d: Dictionary, _me: int, x: int) -> Dictionary:
	if int(d["settled_total"].get(x, 0)) <= 3:
		var ev: Array = []
		for p in d["passes"]:
			if p["settled"].has(x):
				ev.append(p["settled"][x]["seq"])
		ev.append(d["last_seq"])
		return _ok(ev)
	return _no()


# ————————————————————————— 中难度 —————————————————————————

func m05_double_burden(d: Dictionary, me: int, _x: int) -> Dictionary:
	for p in d["passes"]:
		var s = p["settled"].get(me, null)
		if s != null and s["count"] >= 2 and s["after"] > 0:
			return _ok([s["seq"]])
	return _no()


func m06_take_from_target(d: Dictionary, me: int, x: int) -> Dictionary:
	for p in d["passes"]:
		for t in d["transfers"]:
			if t["round"] != p["round"] or not t["accept"]:
				continue
			if t["requester"] != me or t["target"] != x:
				continue
			if p["holders"].get(t["disaster"], -1) == me:
				return _ok([t["seq"], p["seq"]])
	return _no()


## 公开承诺认可 + 最终投反对 + 该协商轮被否决。
## 采用参与式定义，不区分是否关键票：严格 but-for 在多张反对票时会导致全员免责。
func m07_broken_promise(d: Dictionary, me: int, _x: int) -> Dictionary:
	for n in d["negos"]:
		if not n["vetoed"]:
			continue
		if not n["promises"].has(me):
			continue
		if n["votes"].has(me) and not n["votes"][me]:
			return _ok([n["promises"][me], n["seq"]])
	return _no()


func m08_hands_clean(d: Dictionary, me: int, _x: int) -> Dictionary:
	for p in d["passes"]:
		var held: Dictionary = d["held_in_round"].get(p["round"], {})
		if not held.has(me):
			continue
		if not p["settled"].has(me):
			return _ok([p["seq"]])
	return _no()


# ————————————————————————— 高难度 —————————————————————————

func m09_four_way(d: Dictionary, _me: int, _x: int) -> Dictionary:
	for p in d["passes"]:
		var per := {}
		for did in p["holders"]:
			var h: int = p["holders"][did]
			per[h] = int(per.get(h, 0)) + 1
		if per.size() != 4:
			continue
		var each_one := true
		for h in per:
			if per[h] != 1:
				each_one = false
				break
		if each_one:
			return _ok([p["seq"]])
	return _no()


func m10_lowest_third(d: Dictionary, me: int, _x: int) -> Dictionary:
	if not bool(d["alive"].get(me, false)):
		return _no()
	var values: Array = []
	for s in d["seats"]:
		if bool(d["alive"].get(s, false)):
			values.append(int(d["final_lifespan"][s]))
	values.sort()
	if values.is_empty():
		return _no()
	var cut: int = maxi(1, int(ceil(float(values.size()) / 3.0)))
	var mine: int = int(d["final_lifespan"][me])
	var strictly_below := 0
	for v in values:
		if v < mine:
			strictly_below += 1
	if strictly_below < cut:
		return _ok([d["last_seq"]])
	return _no()


## 需要其余所有人都投认可——单人无法独立完成，与 M-07 在同一协商轮内直接互斥。
func m11_lone_dissent(d: Dictionary, me: int, _x: int) -> Dictionary:
	for p in d["passes"]:
		if p["rejects"] != 1:
			continue
		if p["votes"].has(me) and not p["votes"][me]:
			return _ok([p["seq"]])
	return _no()


func m12_never_settled(d: Dictionary, me: int, _x: int) -> Dictionary:
	if not bool(d["alive"].get(me, false)):
		return _no()
	if d["passes"].is_empty():
		return _no()
	var ev: Array = []
	for p in d["passes"]:
		if p["settled"].has(me):
			return _no()
		ev.append(p["seq"])
	return _ok(ev)
