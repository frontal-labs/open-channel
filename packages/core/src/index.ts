export type { PublicErrorDetails } from "@frontal-labs/error";
export { getRootCause, hasCode, isFrontalError } from "@frontal-labs/error";
export type {
  OpenChannelErrorCode,
  OpenChannelErrorDetails,
  OpenChannelErrorOptions,
  OpenChannelErrorStage,
  OpenChannelFailureRecord,
  OpenChannelToolFailure,
} from "./errors.js";
export {
  ActionError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  OpenChannelError,
  ProtocolError,
  TransportError,
  toChannelText,
  toFailureRecord,
  toToolFailure,
  ValidationError,
} from "./errors.js";
export { createActionId, createCorrelationId, createIdentifier } from "./identifiers.js";
export type { CoreEventHandler, EventBus } from "./types.js";
