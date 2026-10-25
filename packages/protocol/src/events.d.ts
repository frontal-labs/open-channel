import { type Timestamp } from "@bufbuild/protobuf/wkt";
import { type EventType } from "./constants.js";
import {
  type ActorRef,
  type ChannelRef,
  type ConversationRef,
  type EventEnvelope,
} from "./generated.js";

export { EVENT_TYPES, type EventType, PROTOCOL_VERSION } from "./constants.js";
/** Any populated payload variant of the envelope. */
export type EventPayload = Exclude<
  EventEnvelope["payload"],
  {
    case: undefined;
  }
>;
/** Input for `newEvent`. The event name is derived from `payload`, so it is not an input. */
export interface EventInput {
  actor?: ActorRef;
  causationId?: string;
  channel?: ChannelRef;
  conversation?: ConversationRef;
  correlationId?: string;
  eventId?: string;
  extensions?: Record<string, string>;
  idempotencyKey?: string;
  occurredAt?: Date | Timestamp;
  payload: EventPayload;
  recipient?: ActorRef;
  source?: ActorRef;
}
/** Returns the dot-separated event name, derived from the envelope's payload. */
export declare function eventType(event: EventEnvelope): EventType;
/** Builds and validates an envelope. Typed builders such as `messageReceived` call this. */
export declare function newEvent(input: EventInput): EventEnvelope;
/** Checks the envelope's identity, version, and payload invariants. Cheap enough for every hot path. */
export declare function validateEvent(event: EventEnvelope): void;
//# sourceMappingURL=events.d.ts.map
