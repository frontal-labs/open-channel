/** The OCP protocol version carried by every envelope. */
export const PROTOCOL_VERSION = "2.0";
/** Every event name OCP defines. Derived from the payload, never stored on the envelope. */
export const EVENT_TYPES = [
  "message.received",
  "message.sent",
  "task.created",
  "task.assigned",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "approval.expired",
  "escalation.triggered",
  "handoff.initiated",
  "handoff.completed",
  "policy.allowed",
  "policy.blocked",
  "action.executed",
  "action.failed",
];
//# sourceMappingURL=constants.js.map
