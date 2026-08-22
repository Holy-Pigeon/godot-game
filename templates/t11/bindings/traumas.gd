class_name T11TraumaBindings
extends RefCounted

## 绑定表 ③：本关损失事件 → 创伤 W1–W8（docs/14 T-11 创伤供给）。
## 缺失这张表，本关打得再惨也不产生渴望，所有回响都会卡在渴望阈值上。
##
## ⚠ W6 的口径必须是「他人因我而实际损失余命」，不得绑定致人死亡——
## 6 人局未必常出现失守，绑死会让 E-03 近乎不可激活（docs/14）。

const TABLE: Array = [
	{"when": &"promise_broken", "feeds": ["W1", "W4"]},
	{"when": &"proposal_ignored", "feeds": ["W8"]},
	{"when": &"transfer_refused", "feeds": ["W5"]},
	{"when": &"forced_burden", "feeds": ["W3"]},
	{"when": &"near_zero_settlement", "feeds": ["W2", "W7"]},
	{"when": &"loss_caused_by_me", "feeds": ["W6"]},
]
