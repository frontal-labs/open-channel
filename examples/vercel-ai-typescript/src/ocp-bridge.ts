/**
 * OCP bridge for the framework examples. Copy this file into each example's `src/` directory.
 *
 * OCP concepts in this file:
 * - `message.received`: an inbound envelope built by `inboundMessage` and ingested with `app.ingest`.
 * - Agent: one OCP agent whose `onMessage` calls the framework handler and replies through OCP.
 * - Channel sink: the "example" channel records each outbound `message.sent` in memory.
 * - Policy: every action target is denied unless it is allowlisted (see `allowOnlyTargets`).
 * - Event store: an in-memory store that keeps events and action claims for this process only.
 *
 * The framework (LangChain, Vercel AI SDK, MCP) runs inside `TextHandler`. OCP wraps it and
 * decides what leaves the boundary. Nothing in this file calls a model or a network service.
 */
import { randomUUID } from "node:crypto";

import {
  type ActionDefinition,
  type AgentContext,
  type ChannelDefinition,
  deliveryReceipt,
  type EventEnvelope,
  eventType,
  fromJson,
  type OpenChannelOptions,
  openChannel,
  PROTOCOL_VERSION,
} from "ocp-sdk";

/** Event store type accepted by `openChannel`. */
type EventStore = OpenChannelOptions["store"];

/** Policy engine type accepted by `openChannel`. */
type PolicyEngine = OpenChannelOptions["policy"];

/** Provider name used for the example channel and its sink. */
const CHANNEL_PROVIDER = "example";

/** Channel identifier stamped on the inbound `message.received` envelope. */
const CHANNEL_ID = "channel:example";

/** Conversation identifier stamped on the inbound envelope. */
const CONVERSATION_ID = "conversation:example";

/** Human actor that sends the example message. */
const HUMAN_ACTOR_ID = "human:example";

/** Policy identifier reported in decisions made by `allowOnlyTargets`. */
const TARGET_ALLOWLIST_POLICY_ID = "policy:target-allowlist";

/**
 * Handles one inbound message and returns the reply text. The framework adapter implements this:
 * it receives the message text and the OCP `AgentContext` (for example, to call `context.request`).
 */
export type TextHandler = (text: string, context: AgentContext) => string | Promise<string>;

/** Inputs for `runOpenChannelTextAgent`. */
export interface BridgeOptions {
  /** Actions the agent may request through OCP. Omit for an agent with no actions. */
  actions?: ActionDefinition<unknown, unknown>[];
  /** Framework call that produces the reply text. */
  handler: TextHandler;
  /** Text of the single inbound message that the example sends. */
  input: string;
  /** Display name. The agent ID is derived from it: `agent:<name in lowercase, spaces as hyphens>`. */
  name: string;
  /** Policy engine. Defaults to `allowOnlyTargets([])`, which denies every action. */
  policy?: PolicyEngine;
}

/**
 * Runs one inbound message through a real OCP application and prints the dispatched reply as JSON.
 *
 * Flow: start the app, ingest one `message.received`, let the agent call `options.handler`, stop
 * the app, then read the `message.sent` the channel sink received. Throws if the handler failed
 * or no reply was dispatched.
 *
 * @param options - The handler, the input text, the agent name, and optional actions and policy.
 * @throws The first error reported through the OCP `onError` hook, or an error if no reply was sent.
 */
export async function runOpenChannelTextAgent(options: BridgeOptions): Promise<void> {
  // Derived ID keeps the agent identifier stable and readable, for example "agent:mcp-tool-agent".
  const agentId = `agent:${options.name.toLowerCase().replace(/\s+/g, "-")}`;
  const sent: EventEnvelope[] = [];
  let failure: unknown;

  // The example channel does not talk to a provider. It records outbound events for this script.
  const channel: ChannelDefinition = {
    provider: CHANNEL_PROVIDER,
    sink: {
      provider: CHANNEL_PROVIDER,
      send: (event) => {
        sent.push(event);
        return Promise.resolve(deliveryReceipt(CHANNEL_PROVIDER, event));
      },
    },
  };

  const app = openChannel({
    actions: options.actions,
    agents: [
      {
        description: `OCP bridge for ${options.name}`,
        id: agentId,
        name: options.name,
        onMessage: async (context) => {
          await context.reply(await options.handler(context.message.text, context));
        },
        skills: [{ id: "respond", name: "Respond to an OCP message" }],
      },
    ],
    channels: [channel],
    hooks: {
      // Errors raised while the app handles the message are reported here, not thrown. Keep the first
      // one and rethrow it after `app.stop()` has run.
      onError: (error) => {
        failure ??= error;
      },
    },
    policy: options.policy ?? allowOnlyTargets([]),
    store: createMemoryEventStore(),
  });

  await app.start();
  await app.ingest(inboundMessage(options.input, agentId));
  await app.stop();

  if (failure !== undefined) {
    throw failure instanceof Error ? failure : new Error(String(failure));
  }

  const [reply] = sent.filter((event) => eventType(event) === "message.sent");
  if (reply?.payload.case !== "messageSent") {
    throw new Error("The OCP bridge did not dispatch a message.sent reply");
  }

  console.log(
    JSON.stringify(
      {
        agentCard: app.agentCards().find((card) => card.id === agentId),
        correlationId: reply.correlationId,
        eventType: eventType(reply),
        reply: reply.payload.value.text,
      },
      null,
      2,
    ),
  );
}

/**
 * Policy that allows an action only when its target is in `targets`. Every other request is
 * denied. Approvals are never required by this policy.
 *
 * @param targets - Exact action targets that may run, for example `["mcp:echo"]`.
 * @returns A `PolicyEngine` to pass to `openChannel` or `runOpenChannelTextAgent`.
 */
export function allowOnlyTargets(targets: readonly string[]): PolicyEngine {
  return {
    evaluate: ({ actionType, target }) => {
      const allowed = target !== undefined && targets.includes(target);
      return {
        allowed,
        approvalRequired: false,
        policyId: TARGET_ALLOWLIST_POLICY_ID,
        reason: allowed
          ? `${actionType} target is allowlisted`
          : `${actionType} target is not allowlisted`,
      };
    },
  };
}

/**
 * Builds a `message.received` envelope from a ProtoJSON object. Uses only the public `fromJson`,
 * so the envelope matches what a real provider adapter would produce.
 */
function inboundMessage(text: string, agentId: string): EventEnvelope {
  return fromJson({
    actor: { id: HUMAN_ACTOR_ID, type: "ACTOR_TYPE_HUMAN" },
    channel: { channelId: CHANNEL_ID, provider: CHANNEL_PROVIDER },
    conversation: { id: CONVERSATION_ID },
    eventId: randomUUID(),
    messageReceived: { text },
    occurredAt: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
    recipient: { id: agentId, type: "ACTOR_TYPE_AGENT" },
  });
}

/**
 * In-memory event store for this example only. Nothing survives a restart, and it does not
 * coordinate across processes. Use a durable store in production.
 */
function createMemoryEventStore(): EventStore {
  const events = new Map<string, EventEnvelope>();
  // Action records track claim, completion, and failure. A second claim of the same action ID is refused.
  const actions = new Map<
    string,
    {
      actionId: string;
      error?: unknown;
      owner?: string;
      result?: unknown;
      status: "claimed" | "completed" | "failed";
    }
  >();

  return {
    all: () => Promise.resolve([...events.values()]),
    append: (event) => {
      events.set(event.eventId, event);
      return Promise.resolve();
    },
    // Returns false for a duplicate event ID, which makes repeated delivery harmless.
    appendIfAbsent: (event) => {
      if (events.has(event.eventId)) {
        return Promise.resolve(false);
      }
      events.set(event.eventId, event);
      return Promise.resolve(true);
    },
    // Returns false when another owner already claimed the action.
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
    list: (options = {}) => Promise.resolve(filterEvents([...events.values()], options)),
    query: (options = {}) => Promise.resolve(filterEvents([...events.values()], options)),
  };
}

/** Filters events by type and keeps only the most recent `limit` matches. */
function filterEvents(
  events: EventEnvelope[],
  options: { eventType?: string; limit?: number },
): EventEnvelope[] {
  const matching = options.eventType
    ? events.filter((event) => eventType(event) === options.eventType)
    : events;
  return options.limit === undefined ? matching : matching.slice(-options.limit);
}
