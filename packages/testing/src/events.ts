import { type EventEnvelope, type EventType, eventType } from "ocp-protocol";

/** Returns event types in their original order. */
export function eventTypes(events: readonly EventEnvelope[]): EventType[] {
  return events.map((event) => eventType(event));
}

/** Returns all events with the requested event type. */
export function eventsOfType(events: readonly EventEnvelope[], type: EventType): EventEnvelope[] {
  return events.filter((event) => eventType(event) === type);
}

/** Returns the first event with the requested type, if one exists. */
export function findEvent(
  events: readonly EventEnvelope[],
  type: EventType,
): EventEnvelope | undefined {
  return events.find((event) => eventType(event) === type);
}

/** Returns the first event with the requested type or throws a useful test error. */
export function requireEvent(events: readonly EventEnvelope[], type: EventType): EventEnvelope {
  const event = findEvent(events, type);
  if (!event) {
    throw new Error(`Expected OCP event ${type}; received ${eventTypes(events).join(", ")}`);
  }
  return event;
}

/** Records values while preserving insertion order for assertions. */
export interface TestRecorder<TValue> {
  clear: () => void;
  record: (value: TValue) => void;
  readonly values: TValue[];
}

/** Creates a simple recorder for events, calls, or other test observations. */
export function createTestRecorder<TValue>(): TestRecorder<TValue> {
  const values: TValue[] = [];
  return {
    clear: () => {
      values.length = 0;
    },
    record: (value) => {
      values.push(value);
    },
    values,
  };
}
