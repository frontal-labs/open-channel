import { type EventEnvelope, eventType as typeOf } from "ocp-protocol";

/** Action bookkeeping record kept by a test event store. */
export interface TestActionRecord {
  actionId: string;
  error?: unknown;
  owner?: string;
  result?: unknown;
  status: "claimed" | "completed" | "failed";
}

/**
 * Event store fixture for runtime and SDK tests. It is structurally compatible with the runtime
 * `EventStore` contract, so it can be passed wherever a store is required.
 */
export interface TestEventStore {
  all: () => Promise<EventEnvelope[]>;
  append: (event: EventEnvelope) => Promise<void>;
  appendIfAbsent: (event: EventEnvelope) => Promise<boolean>;
  claimAction: (actionId: string, owner: string) => Promise<boolean>;
  close: () => void;
  completeAction: (actionId: string, result: unknown) => Promise<void>;
  failAction: (actionId: string, error: unknown) => Promise<void>;
  get: (eventId: string) => Promise<EventEnvelope | undefined>;
  getAction: (actionId: string) => Promise<TestActionRecord | undefined>;
  has: (eventId: string) => Promise<boolean>;
  list: (options?: { eventType?: string; limit?: number }) => Promise<EventEnvelope[]>;
  query: (options?: { eventType?: string; limit?: number }) => Promise<EventEnvelope[]>;
}

/** Append-only event log with O(1) lookup by event ID. */
class RecordingEventStore implements TestEventStore {
  /** Events in arrival order; `list()` slices this log instead of copying the whole store. */
  private readonly log: EventEnvelope[] = [];
  /** Maps each event ID to its position in `log`, so lookups never scan. */
  private readonly positions: Partial<Record<string, number>> = Object.create(null);
  private readonly actions: Partial<Record<string, TestActionRecord>> = Object.create(null);

  all(): Promise<EventEnvelope[]> {
    return Promise.resolve(this.log.slice());
  }

  append(event: EventEnvelope): Promise<void> {
    this.put(event);
    return Promise.resolve();
  }

  appendIfAbsent(event: EventEnvelope): Promise<boolean> {
    if (event.eventId in this.positions) {
      return Promise.resolve(false);
    }
    this.put(event);
    return Promise.resolve(true);
  }

  claimAction(actionId: string, owner: string): Promise<boolean> {
    if (actionId in this.actions) {
      return Promise.resolve(false);
    }
    this.actions[actionId] = { actionId, owner, status: "claimed" };
    return Promise.resolve(true);
  }

  close(): void {
    // Nothing to release: all state lives in this object.
  }

  completeAction(actionId: string, result: unknown): Promise<void> {
    const current = this.actions[actionId];
    this.actions[actionId] = { actionId, owner: current?.owner, result, status: "completed" };
    return Promise.resolve();
  }

  failAction(actionId: string, error: unknown): Promise<void> {
    const current = this.actions[actionId];
    this.actions[actionId] = { actionId, error, owner: current?.owner, status: "failed" };
    return Promise.resolve();
  }

  get(eventId: string): Promise<EventEnvelope | undefined> {
    const position = this.positions[eventId];
    return Promise.resolve(position === undefined ? undefined : this.log[position]);
  }

  getAction(actionId: string): Promise<TestActionRecord | undefined> {
    return Promise.resolve(this.actions[actionId]);
  }

  has(eventId: string): Promise<boolean> {
    return Promise.resolve(eventId in this.positions);
  }

  list(options: { eventType?: string; limit?: number } = {}): Promise<EventEnvelope[]> {
    const { eventType: wanted, limit } = options;
    if (!wanted) {
      return Promise.resolve(limit === undefined ? this.log.slice() : this.log.slice(-limit));
    }
    const matches = this.log.filter((event) => typeOf(event) === wanted);
    return Promise.resolve(limit === undefined ? matches : matches.slice(-limit));
  }

  query(options: { eventType?: string; limit?: number } = {}): Promise<EventEnvelope[]> {
    return this.list(options);
  }

  /** Appends a new event, or replaces an existing one in place (same position, as with a Map). */
  private put(event: EventEnvelope): void {
    const position = this.positions[event.eventId];
    if (position === undefined) {
      this.positions[event.eventId] = this.log.push(event) - 1;
    } else {
      this.log[position] = event;
    }
  }
}

/** Creates an empty event store for tests. Each call returns an independent store. */
export function createTestEventStore(): TestEventStore {
  return new RecordingEventStore();
}
