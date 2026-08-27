export { T11Template } from './template.ts'
export {
  T11_COMMANDS,
  T11_DEFAULT_PARAMS,
  T11_EVENTS,
  T11_PHASES,
  actOfRound,
  baseLossOfRound,
  lossPerMark,
  marksHeldBy,
  tallyOf,
  unallocatedMarks,
} from './types.ts'
export type {
  HolderChangeSource,
  T11Endgame,
  T11EndgameReason,
  T11HiddenState,
  T11Mark,
  T11MandateAssignment,
  T11MandateVerdict,
  T11Params,
  T11PendingTransfer,
  T11Phase,
  T11SeatTally,
  T11State,
  T11Verdict,
  T11Vote,
} from './types.ts'
export { T11_MANDATES, MANDATE_BY_ID, mandateAwardOf } from './mandates.ts'
export type {
  LossSettledPayload,
  MandateDefinition,
  MandateDifficulty,
  MandateVerdict,
  TransferRespondedPayload,
  VotesRevealedPayload,
} from './mandates.ts'
export { gateConditionsMet, participatedThisRound, perfectClearPercent } from './hidden.ts'
export { buildPredicateBindings } from './predicates.ts'
export { T11ViewProjection } from './view.ts'
