import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate, timestampNow } from "@bufbuild/protobuf/wkt";
import { ValidationError } from "ocp-core";
import { PROTOCOL_VERSION } from "./constants.js";
import { ApprovalOutcome, EventEnvelopeSchema } from "./generated.js";

export { EVENT_TYPES, PROTOCOL_VERSION } from "./constants.js";

/** Event name implied by a payload when the payload alone is unambiguous. */
const EVENT_TYPE_BY_PAYLOAD_CASE = {
  actionExecuted: "action.executed",
  actionFailed: "action.failed",
  approvalDecided: "approval.granted",
  approvalExpired: "approval.expired",
  approvalRequested: "approval.requested",
  escalationTriggered: "escalation.triggered",
  handoffCompleted: "handoff.completed",
  handoffInitiated: "handoff.initiated",
  messageReceived: "message.received",
  messageSent: "message.sent",
  policyEvaluated: "policy.allowed",
  taskAssigned: "task.assigned",
  taskCreated: "task.created",
};
/** Event name for the payload, resolving approval outcomes and policy decisions. */
function payloadEventType(payload) {
  if (payload.case === "approvalDecided") {
    return payload.value.outcome === ApprovalOutcome.DENIED
      ? "approval.denied"
      : "approval.granted";
  }
  if (payload.case === "policyEvaluated") {
    return payload.value.allowed ? "policy.allowed" : "policy.blocked";
  }
  const name = EVENT_TYPE_BY_PAYLOAD_CASE[payload.case];
  if (!name) {
    throw new ValidationError(`Unsupported OCP payload: ${payload.case}`);
  }
  return name;
}
/** Returns the dot-separated event name, derived from the envelope's payload. */
export function eventType(event) {
  if (!event.payload.case) {
    throw new ValidationError("OCP event must have a payload");
  }
  return payloadEventType(event.payload);
}
function timestamp(value) {
  return value instanceof Date ? timestampFromDate(value) : value;
}
/** Builds and validates an envelope. Typed builders such as `messageReceived` call this. */
export function newEvent(input) {
  const event = create(EventEnvelopeSchema, {
    actor: input.actor,
    causationId: input.causationId ?? "",
    channel: input.channel,
    conversation: input.conversation,
    correlationId: input.correlationId ?? "",
    eventId: input.eventId ?? randomUUID(),
    extensions: input.extensions ?? {},
    idempotencyKey: input.idempotencyKey ?? "",
    occurredAt: timestamp(input.occurredAt) ?? timestampNow(),
    payload: input.payload,
    protocolVersion: PROTOCOL_VERSION,
    recipient: input.recipient,
    source: input.source,
  });
  validateEvent(event);
  return event;
}
/** Checks the envelope's identity, version, and payload invariants. Cheap enough for every hot path. */
export function validateEvent(event) {
  if (!event.eventId.trim()) {
    throw new ValidationError("OCP event must have an event_id");
  }
  if (event.protocolVersion !== PROTOCOL_VERSION) {
    throw new ValidationError(
      `OCP event requires protocol_version ${PROTOCOL_VERSION}, received ${event.protocolVersion || "none"}`,
    );
  }
  if (!event.occurredAt) {
    throw new ValidationError("OCP event must have occurred_at");
  }
  const { payload } = event;
  if (!payload.case) {
    throw new ValidationError("OCP event must have a payload");
  }
  if (payload.case === "approvalRequested") {
    validateApprovalRequested(payload.value);
  }
  if (payload.case === "approvalDecided") {
    validateApprovalDecided(payload.value, payloadEventType(payload));
  }
}
function validateApprovalRequested(value) {
  if (!value.approvalId.trim()) {
    throw new ValidationError("approval.requested must have an approval_id");
  }
  if (!(value.agent && value.approver)) {
    throw new ValidationError("approval.requested must identify an agent and approver");
  }
  if (!value.requestedAction) {
    throw new ValidationError("approval.requested must include a requested_action");
  }
  if (!value.deadline) {
    throw new ValidationError("approval.requested must have a deadline");
  }
}
function validateApprovalDecided(value, name) {
  if (!value.approvalId.trim()) {
    throw new ValidationError("approval decision must have an approval_id");
  }
  if (value.outcome !== ApprovalOutcome.GRANTED && value.outcome !== ApprovalOutcome.DENIED) {
    throw new ValidationError("approval decision must be granted or denied");
  }
  if (name === "approval.granted" && value.outcome !== ApprovalOutcome.GRANTED) {
    throw new ValidationError("approval.granted must have a granted outcome");
  }
  if (name === "approval.denied" && value.outcome !== ApprovalOutcome.DENIED) {
    throw new ValidationError("approval.denied must have a denied outcome");
  }
}
//# sourceMappingURL=events.js.map
