class_name EventSink
extends RefCounted

## 事件订阅接口。渴望引擎与局后推断都是纯事件消费者，接入时内核零改动。

func on_event(_e) -> void:
	pass


func on_match_end(_summary: Dictionary) -> void:
	pass
