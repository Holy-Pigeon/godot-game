/**
 * 内核层（docs/15 §1）：纯数据、纯函数、可无界面运行、可重放。
 *
 * 硬规则：本层不引用任何具体模板的符号。由 scripts/check-layering.ts 保证，不靠自觉。
 */

export type { DeepReadonly, KernelState, PhaseId, SeatId, SeatState } from './state.ts'
export { findSeat, isLiving, livingSeats, mutableSeat, seatsInOrder } from './state.ts'

export type { EventDraft, EventRecord, Stream, Visibility } from './event.ts'
export { corpusEvent, PUBLIC, ruleEvent, SERVER_ONLY, selfOnly, toSeats, visibleTo } from './event.ts'

export type { Command, CommandResult, Validation } from './command.ts'
export { accept, command, reject } from './command.ts'

export { EventLog } from './log.ts'

export type { RandomSnapshot } from './random.ts'
export { SeededRandom } from './random.ts'

export { sha256Hex } from './hash.ts'

export type { MatchSnapshot } from './snapshot.ts'
export { canonicalize, ruleStreamHash, stateHash } from './snapshot.ts'

export type { FactWindow } from './facts.ts'
export { FactProjection } from './facts.ts'

export type {
  AnchorBindings,
  AnchorId,
  CompatibilityMatrix,
  PredicateArgs,
  PredicateBinding,
  PredicateBindings,
  PredicateId,
  PredicateInput,
  PredicateValue,
  TraumaBinding,
  TraumaBindings,
  TraumaId,
} from './bindings.ts'
export {
  ALL_ANCHOR_IDS,
  ALL_PREDICATE_IDS,
  ANCHOR_VOCABULARY,
  buildCompatibilityMatrix,
  deadPredicates,
  PREDICATE_VOCABULARY,
  TRAUMA_VOCABULARY,
} from './bindings.ts'

export type {
  PhaseAdvance,
  PhaseDeclaration,
  SettlementDeclaration,
  Template,
  TemplateContext,
} from './template.ts'

export type { RuntimeOptions, SeatSetup, Subscriber } from './runtime.ts'
export { buildInitialState, replay, Runtime } from './runtime.ts'

export type {
  ActionOption,
  FeedItem,
  PublicItemView,
  SeatView,
  ViewModel,
  ViewProjection,
} from './view.ts'
