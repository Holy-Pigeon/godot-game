-- 终焉之地 · 对局记录（docs/13 双流记录、docs/15 §2.3）
--
-- 规则事件流与行为语料流分开两张表，不是一张带 stream 列的表。
-- docs/13 的硬性验收是「删掉行为语料流后重放规则事件流，结算结果完全一致」——
-- 分表让「删掉语料流」在存储层就是 DROP 一张表的数据，而不是带条件的过滤。
-- 两条流共用同一条单调递增的序号轴，因此 seq 在一局内跨两表唯一。

CREATE TABLE IF NOT EXISTS matches (
  match_id      TEXT PRIMARY KEY,
  template_id   TEXT        NOT NULL,
  seed          BIGINT      NOT NULL,
  seat_count    INTEGER     NOT NULL,
  version       TEXT        NOT NULL,
  -- 含 GM 来源事件的整局标记为 GM 局，结算结果不写入正式余命账本（docs/15 §9）
  gm_match      BOOLEAN     NOT NULL DEFAULT FALSE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  -- 终局留档：三条路径都无条件写出（docs/15 §7.5）
  endgame_reason      TEXT,
  co_decision_rounds  INTEGER,
  gate_ring_turns     INTEGER,
  state_hash          TEXT,
  rule_stream_hash    TEXT
);

CREATE TABLE IF NOT EXISTS rule_events (
  match_id          TEXT    NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  timestamp_ms      BIGINT  NOT NULL,
  level_round       INTEGER NOT NULL,
  negotiation_round INTEGER NOT NULL,
  phase             TEXT    NOT NULL,
  actor             INTEGER,
  type              TEXT    NOT NULL,
  payload           JSONB   NOT NULL,
  visibility        JSONB   NOT NULL,
  gm_origin         BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (match_id, seq)
);

CREATE TABLE IF NOT EXISTS corpus_events (
  match_id          TEXT    NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  timestamp_ms      BIGINT  NOT NULL,
  level_round       INTEGER NOT NULL,
  negotiation_round INTEGER NOT NULL,
  phase             TEXT    NOT NULL,
  actor             INTEGER,
  type              TEXT    NOT NULL,
  payload           JSONB   NOT NULL,
  visibility        JSONB   NOT NULL,
  PRIMARY KEY (match_id, seq)
);

-- docs/13：分析入口必须能按序号窗口取出一句话前后的规则事件
CREATE INDEX IF NOT EXISTS rule_events_seq_idx   ON rule_events (match_id, seq);
CREATE INDEX IF NOT EXISTS corpus_events_seq_idx ON corpus_events (match_id, seq);
CREATE INDEX IF NOT EXISTS rule_events_type_idx  ON rule_events (match_id, type);
