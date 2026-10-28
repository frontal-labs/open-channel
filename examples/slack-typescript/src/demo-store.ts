/**
 * Demo-only in-memory `EventStore` for the OCP examples.
 *
 * OCP concept: the event store is where `openChannel()` persists every event
 * envelope and action record. This file is NOT production code. It loses all
 * state when the process exits. For durable storage, pass a store such as
 * `@openchannelprotocol/sdk/postgres` to `openChannel()` instead.
 */
import type { EventEnvelope, OpenChannelOptions } from "@openchannelprotocol/sdk";
import { eventType } from "@openchannelprotocol/sdk";

/** The store contract that `openChannel()` expects. */
type EventStore = OpenChannelOptions["store"];

/** A single action record as returned by `EventStore.getAction`. */
type ActionRecord = Awaited<ReturnType<NonNullable<EventStore["getAction"]>>>;

/**
 * Creates an in-memory `EventStore`.
 *
 * Events are keyed by `eventId`, so appending the same event twice keeps one copy.
 * Actions move through `claimed` -> `completed` or `failed`.
 *
 * @returns An `EventStore` backed by plain `Map`s. Use it only for demos and tests.
 */
export function createDemoEventStore(): EventStore {
  const events = new Map<string, EventEnvelope>();
  const actions = new Map<string, ActionRecord & object>();

  /**
   * Filters stored events by type and optionally keeps only the most recent ones.
   *
   * @param options.eventType - Only return events of this OCP type, e.g. `message.sent`.
   * @param options.limit - Return at most this many of the newest matches.
   */
  const filter = (options: { eventType?: string; limit?: number } = {}): EventEnvelope[] => {
    const all = [...events.values()];
    const matching = options.eventType
      ? all.filter((event) => eventType(event) === options.eventType)
      : all;
    return options.limit === undefined ? matching : matching.slice(-options.limit);
  };

  return {
    all: () => Promise.resolve([...events.values()]),
    append: (event) => {
      events.set(event.eventId, event);
      return Promise.resolve();
    },
    /** Resolves `false` when the event id was already stored, so retries are ignored. */
    appendIfAbsent: (event) => {
      if (events.has(event.eventId)) {
        return Promise.resolve(false);
      }
      events.set(event.eventId, event);
      return Promise.resolve(true);
    },
    /**
     * Claims an action for one owner. Resolves `false` if the action was already claimed,
     * which prevents the same action from running twice.
     */
    claimAction: (actionId, owner) => {
      if (actions.has(actionId)) {
        return Promise.resolve(false);
      }
      actions.set(actionId, { actionId, owner, status: "claimed" });
      return Promise.resolve(true);
    },
    completeAction: (actionId, result) => {
      actions.set(actionId, { actionId, result, status: "completed" });
      return Promise.resolve();
    },
    failAction: (actionId, error) => {
      actions.set(actionId, { actionId, error, status: "failed" });
      return Promise.resolve();
    },
    get: (eventId) => Promise.resolve(events.get(eventId)),
    getAction: (actionId) => Promise.resolve(actions.get(actionId)),
    has: (eventId) => Promise.resolve(events.has(eventId)),
    list: (options) => Promise.resolve(filter(options)),
    query: (options) => Promise.resolve(filter(options)),
  };
}
