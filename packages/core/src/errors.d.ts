/** A stable error code emitted by an OCP package. */
export type OpenChannelErrorCode =
  | "OCP_ACTION"
  | "OCP_AUTHORIZATION"
  | "OCP_CONFLICT"
  | "OCP_NOT_FOUND"
  | "OCP_PROTOCOL"
  | "OCP_TRANSPORT"
  | "OCP_VALIDATION";
/** Structured metadata attached to an OCP error. */
export type OpenChannelErrorDetails = Record<string, unknown>;
/** Lifecycle stage at which an OCP operation failed. */
export type OpenChannelErrorStage =
  | "accept"
  | "action"
  | "approval"
  | "delivery"
  | "normalize"
  | "policy"
  | "processing"
  | "shutdown"
  | "validation"
  | (string & {});
/** Options shared by all OCP error constructors. */
export interface OpenChannelErrorOptions {
  actionId?: string;
  approvalId?: string;
  cause?: unknown;
  details?: OpenChannelErrorDetails;
  eventId?: string;
  provider?: string;
  retryable?: boolean;
  stage?: OpenChannelErrorStage;
}
/** Base class for errors that are safe to classify at an application boundary. */
export declare class OpenChannelError extends Error {
  readonly code: OpenChannelErrorCode;
  readonly details: OpenChannelErrorDetails;
  readonly actionId?: string;
  readonly approvalId?: string;
  readonly eventId?: string;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly stage?: OpenChannelErrorStage;
  constructor(code: OpenChannelErrorCode, message: string, options?: OpenChannelErrorOptions);
}
/** Indicates that a registered action could not be executed. */
export declare class ActionError extends OpenChannelError {
  constructor(message: string, options?: OpenChannelErrorOptions);
}
/** Indicates that an input does not satisfy the OCP contract. */
export declare class ValidationError extends OpenChannelError {
  constructor(message: string, options?: OpenChannelErrorOptions);
}
/** Indicates that an OCP event or protocol operation is invalid. */
export declare class ProtocolError extends OpenChannelError {
  constructor(message: string, options?: OpenChannelErrorOptions);
}
/** Indicates that an operation conflicts with the current resource state. */
export declare class ConflictError extends OpenChannelError {
  constructor(resource: string, identifier: string, options?: OpenChannelErrorOptions);
}
/** Indicates that the actor is not allowed to perform the requested OCP operation. */
export declare class AuthorizationError extends OpenChannelError {
  constructor(message: string, options?: OpenChannelErrorOptions);
}
/** Indicates that a requested OCP resource does not exist. */
export declare class NotFoundError extends OpenChannelError {
  constructor(resource: string, identifier: string, options?: OpenChannelErrorOptions);
}
/** Indicates that a provider channel could not accept an OCP operation. */
export declare class TransportError extends OpenChannelError {
  constructor(message: string, options?: OpenChannelErrorOptions);
}
//# sourceMappingURL=errors.d.ts.map
