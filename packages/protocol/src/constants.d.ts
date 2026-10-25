/** The OCP protocol version carried by every envelope. */
export declare const PROTOCOL_VERSION: "2.0";
/** Every event name OCP defines. Derived from the payload, never stored on the envelope. */
export declare const EVENT_TYPES: readonly [
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
/** A friendly, dot-separated event name such as `approval.granted`. */
export type EventType = (typeof EVENT_TYPES)[number];
//# sourceMappingURL=constants.d.ts.map
