import { randomUUID } from "node:crypto";
/** Creates a UUID-backed identifier with a stable namespace prefix. */
export function createIdentifier(prefix) {
  return `${prefix}:${randomUUID()}`;
}
/** Creates an identifier for correlating related protocol events. */
export function createCorrelationId() {
  return createIdentifier("corr");
}
/** Creates an identifier for an action submitted by an agent. */
export function createActionId() {
  return createIdentifier("action");
}
//# sourceMappingURL=identifiers.js.map
