/**
 * 对局记录持久化（docs/13、docs/15 §2.3）。
 *
 * 两条流分开两张表。写入按序号顺序追加，不更新、不删除——事件是已经发生的事实。
 */

import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import type { EventRecord } from '@terminus/kernel'

export interface MatchRecord {
  readonly matchId: string
  readonly templateId: string
  readonly seed: number
  readonly seatCount: number
  readonly version: string
  readonly gmMatch: boolean
}

export interface MatchOutcome {
  readonly endgameReason: string | null
  readonly coDecisionRounds: number | null
  readonly gateRingTurns: number | null
  readonly stateHash: string
  readonly ruleStreamHash: string
}

export class Storage {
  readonly #pool: Pool

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString })
  }

  async migrate(schemaPath: string): Promise<void> {
    await this.#pool.query(readFileSync(schemaPath, 'utf8'))
  }

  async createMatch(record: MatchRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO matches (match_id, template_id, seed, seat_count, version, gm_match)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (match_id) DO NOTHING`,
      [record.matchId, record.templateId, record.seed, record.seatCount, record.version, record.gmMatch],
    )
  }

  /** 追加事件。规则流与语料流分表写入，共用同一条序号轴。 */
  async appendEvents(matchId: string, events: readonly EventRecord[]): Promise<void> {
    if (events.length === 0) return
    const client = await this.#pool.connect()
    try {
      await client.query('BEGIN')
      for (const event of events) {
        const table = event.stream === 'rule' ? 'rule_events' : 'corpus_events'
        const columns =
          event.stream === 'rule'
            ? '(match_id, seq, timestamp_ms, level_round, negotiation_round, phase, actor, type, payload, visibility, gm_origin)'
            : '(match_id, seq, timestamp_ms, level_round, negotiation_round, phase, actor, type, payload, visibility)'
        const values: unknown[] = [
          matchId,
          event.seq,
          event.timestampMs,
          event.levelRound,
          event.negotiationRound,
          event.phase,
          event.actor,
          event.type,
          JSON.stringify(event.payload),
          JSON.stringify(event.visibility),
        ]
        if (event.stream === 'rule') values.push(event.gmOrigin)
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
        await client.query(
          `INSERT INTO ${table} ${columns} VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async finishMatch(matchId: string, outcome: MatchOutcome, gmMatch: boolean): Promise<void> {
    await this.#pool.query(
      `UPDATE matches
          SET finished_at = now(), endgame_reason = $2, co_decision_rounds = $3,
              gate_ring_turns = $4, state_hash = $5, rule_stream_hash = $6, gm_match = $7
        WHERE match_id = $1`,
      [
        matchId,
        outcome.endgameReason,
        outcome.coDecisionRounds,
        outcome.gateRingTurns,
        outcome.stateHash,
        outcome.ruleStreamHash,
        gmMatch,
      ],
    )
  }

  /** 只读规则事件流，用于重放校验（docs/15 §2.5）。 */
  async loadRuleEvents(matchId: string): Promise<readonly EventRecord[]> {
    const { rows } = await this.#pool.query<{
      seq: number
      timestamp_ms: string
      level_round: number
      negotiation_round: number
      phase: string
      actor: number | null
      type: string
      payload: unknown
      visibility: unknown
      gm_origin: boolean
    }>(`SELECT * FROM rule_events WHERE match_id = $1 ORDER BY seq ASC`, [matchId])

    return rows.map((row) => ({
      seq: row.seq,
      timestampMs: Number(row.timestamp_ms),
      levelRound: row.level_round,
      negotiationRound: row.negotiation_round,
      phase: row.phase,
      actor: row.actor,
      type: row.type,
      payload: row.payload,
      stream: 'rule' as const,
      visibility: row.visibility as EventRecord['visibility'],
      gmOrigin: row.gm_origin,
    }))
  }

  async close(): Promise<void> {
    await this.#pool.end()
  }
}
