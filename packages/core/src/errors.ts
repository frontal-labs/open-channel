import {
  type ErrorMetadata,
  FrontalError,
  isFrontalError,
  type PublicErrorDetails,
} from "@frontal-labs/error";
import { buildErrorResponseData } from "@frontal-labs/error/server";

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
  /** Text that is safe to show to a person in a channel. See {@link toChannelText}. */
  public?: PublicErrorDetails;
  retryable?: boolean;
  stage?: OpenChannelErrorStage;
}

/** HTTP status used when an OCP error crosses an HTTP or tool boundary. */
const STATUS_BY_CODE: Record<OpenChannelErrorCode, number> = {
  OCP_ACTION: 500,
  OCP_AUTHORIZATION: 403,
  OCP_CONFLICT: 409,
  OCP_NOT_FOUND: 404,
  OCP_PROTOCOL: 400,
  OCP_TRANSPORT: 502,
  OCP_VALIDATION: 400,
};

/**
 * Copies the values of `details` that survive JSON. Functions, cycles and other non-serialisable
 * values are left out of `metadata` only; `details` itself is unchanged.
 */
function toSerializableMetadata(details: OpenChannelErrorDetails): ErrorMetadata {
  const metadata: ErrorMetadata = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) {
      continue;
    }
    try {
      metadata[key] = JSON.parse(JSON.stringify(value));
    } catch {
      // Non-serialisable value: keep it in `details` only.
    }
  }
  return metadata;
}

/** Base class for errors that are safe to classify at an application boundary. */
export class OpenChannelError extends FrontalError<OpenChannelErrorCode> {
  declare readonly code: OpenChannelErrorCode;
  readonly details: OpenChannelErrorDetails;
  readonly actionId?: string;
  readonly approvalId?: string;
  readonly eventId?: string;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly stage?: OpenChannelErrorStage;

  constructor(code: OpenChannelErrorCode, message: string, options: OpenChannelErrorOptions = {}) {
    const retryable = options.retryable ?? false;
    const details: OpenChannelErrorDetails = {
      ...options.details,
      ...(options.actionId ? { actionId: options.actionId } : {}),
      ...(options.approvalId ? { approvalId: options.approvalId } : {}),
      ...(options.eventId ? { eventId: options.eventId } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.stage ? { stage: options.stage } : {}),
      ...(retryable ? { retryable: true } : {}),
    };
    super(message, {
      attributes: {
        ...(options.eventId ? { "ocp.event_id": options.eventId } : {}),
        ...(options.actionId ? { "ocp.action_id": options.actionId } : {}),
        ...(options.approvalId ? { "ocp.approval_id": options.approvalId } : {}),
        ...(options.provider ? { "ocp.provider": options.provider } : {}),
        ...(options.stage ? { "ocp.stage": options.stage } : {}),
      },
      cause: options.cause,
      code,
      metadata: toSerializableMetadata(details),
      scope: "ocp",
      statusCode: STATUS_BY_CODE[code],
      ...(options.public ? { public: options.public } : {}),
    });
    this.name = "OpenChannelError";
    this.details = details;
    this.actionId = options.actionId;
    this.approvalId = options.approvalId;
    this.eventId = options.eventId;
    this.provider = options.provider;
    this.retryable = retryable;
    this.stage = options.stage;
  }
}

/** Indicates that a registered action could not be executed. */
export class ActionError extends OpenChannelError {
  constructor(message: string, options: OpenChannelErrorOptions = {}) {
    super("OCP_ACTION", message, { ...options, stage: options.stage ?? "action" });
    this.name = "ActionError";
  }
}

/** Indicates that an input does not satisfy the OCP contract. */
export class ValidationError extends OpenChannelError {
  constructor(message: string, options: OpenChannelErrorOptions = {}) {
    super("OCP_VALIDATION", message, options);
    this.name = "ValidationError";
  }
}

/** Indicates that an OCP event or protocol operation is invalid. */
export class ProtocolError extends OpenChannelError {
  constructor(message: string, options: OpenChannelErrorOptions = {}) {
    super("OCP_PROTOCOL", message, options);
    this.name = "ProtocolError";
  }
}

/** Indicates that an operation conflicts with the current resource state. */
export class ConflictError extends OpenChannelError {
  constructor(resource: string, identifier: string, options: OpenChannelErrorOptions = {}) {
    super(
      "OCP_CONFLICT",
      `${resource} already exists or is in a conflicting state: ${identifier}`,
      {
        ...options,
        details: { ...options.details, identifier, resource },
      },
    );
    this.name = "ConflictError";
  }
}

/** Indicates that the actor is not allowed to perform the requested OCP operation. */
export class AuthorizationError extends OpenChannelError {
  constructor(message: string, options: OpenChannelErrorOptions = {}) {
    super("OCP_AUTHORIZATION", message, options);
    this.name = "AuthorizationError";
  }
}

/** Indicates that a requested OCP resource does not exist. */
export class NotFoundError extends OpenChannelError {
  constructor(resource: string, identifier: string, options: OpenChannelErrorOptions = {}) {
    super("OCP_NOT_FOUND", `${resource} was not found: ${identifier}`, {
      ...options,
      details: { ...options.details, identifier, resource },
    });
    this.name = "NotFoundError";
  }
}

/** Indicates that a provider channel could not accept an OCP operation. */
export class TransportError extends OpenChannelError {
  constructor(message: string, options: OpenChannelErrorOptions = {}) {
    super("OCP_TRANSPORT", message, options);
    this.name = "TransportError";
  }
}

/** Text shown to a person in a channel when an error has no approved `public` message. */
const GENERIC_CHANNEL_TEXT = "Something went wrong.";

/** Fixed channel text per code, used when the error carries no `public` message. */
const CHANNEL_TEXT_BY_CODE: Partial<Record<OpenChannelErrorCode, string>> = {
  OCP_ACTION: "The action couldn't be completed.",
  OCP_AUTHORIZATION: "You're not allowed to do that.",
  OCP_TRANSPORT: "The message couldn't be delivered.",
};

/**
 * Returns text that is safe to post to a person in a channel. Developer messages, details,
 * resource identifiers and policy text never leave this function.
 */
export function toChannelText(err: unknown): string {
  if (!isFrontalError(err)) {
    return GENERIC_CHANNEL_TEXT;
  }
  const publicMessage = err.public?.message;
  if (typeof publicMessage === "string" && publicMessage.trim() !== "") {
    return publicMessage;
  }
  const code = err.code as OpenChannelErrorCode | undefined;
  return (code && CHANNEL_TEXT_BY_CODE[code]) || GENERIC_CHANNEL_TEXT;
}

/**
 * JSON-safe form of a failure for durable storage. It holds developer text and details, so it is
 * for logs, audit and the event store only. Never send it to a channel or an agent.
 */
export interface OpenChannelFailureRecord {
  code?: OpenChannelErrorCode;
  details: ErrorMetadata;
  message: string;
  name: string;
  retryable: boolean;
  stage?: OpenChannelErrorStage;
}

/** Converts any failure into an {@link OpenChannelFailureRecord} that survives `JSON.stringify`. */
export function toFailureRecord(error: unknown): OpenChannelFailureRecord {
  if (error instanceof OpenChannelError) {
    return {
      code: error.code,
      details: toSerializableMetadata(error.details),
      message: error.message,
      name: error.name,
      retryable: error.retryable,
      stage: error.stage,
    };
  }
  return {
    details: {},
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
    retryable: false,
  };
}

/** Fields an agent may receive in a tool failure. Developer text is never among them. */
export interface OpenChannelToolFailure {
  error: {
    code: string;
    hint?: string;
    fix?: string;
    link?: string;
    message: string;
    scope: string;
  };
  success: false;
}

/**
 * Builds the tool result an agent receives for a failed action. It contains only the scope, code
 * and public text (`message`, `hint`, `fix`, `link`). Any failure without approved public text
 * gets the channel text from {@link toChannelText}.
 */
export function toToolFailure(error: unknown): OpenChannelToolFailure {
  const source = error instanceof OpenChannelError ? error : undefined;
  const code = source?.code ?? "OCP_ACTION";
  const publicDetails: PublicErrorDetails = {
    ...source?.public,
    message: source?.public?.message?.trim() ? source.public.message : toChannelText(error),
  };
  const body = buildErrorResponseData({
    code,
    public: publicDetails,
    scope: "ocp",
    statusCode: STATUS_BY_CODE[code],
  });
  const { error: fields } = body;
  return {
    error: {
      code: fields.code ?? code,
      message: fields.message,
      scope: fields.scope ?? "ocp",
      ...(fields.hint ? { hint: fields.hint } : {}),
      ...(fields.fix ? { fix: fields.fix } : {}),
      ...(fields.link ? { link: fields.link } : {}),
    },
    success: false,
  };
}
