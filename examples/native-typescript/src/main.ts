/**
 * Native TypeScript OCP example: a deterministic agent answers one message.
 *
 * OCP concepts demonstrated:
 * - `openChannel()` builds an OCP app from agents, channels, a policy engine, and a store.
 * - `messageReceived()` creates an inbound `message.received` event envelope.
 * - `context.reply()` produces an outbound `message.sent` event, which the channel sink delivers.
 * - The agent card (`app.agentCards()`) advertises the agent's identity and skills.
 *
 * No model, provider, or credential is needed. Run it from the repository root:
 *   pnpm exec tsx examples/native-typescript/src/main.ts
 */
import { create } from "@bufbuild/protobuf";
import {
  ActorRefSchema,
  ActorType,
  type ChannelDefinition,
  ChannelRefSchema,
  type EventEnvelope,
  eventType,
  messageReceived,
  openChannel,
  RuleBasedPolicyEngine,
} from "@openchannelprotocol/sdk";

import { createDemoEventStore } from "./demo-store.js";

/** Stable identifier of the example agent. Also used to look up its agent card. */
const AGENT_ID = "agent:native-typescript";

/** Stable identifier of the demo channel the inbound message arrives on. */
const CHANNEL_ID = "channel:example";

/** Stable identifier of the human who sends the inbound message. */
const HUMAN_ID = "human:example";

/** Text of the inbound message. Fixed so the printed output is deterministic. */
const INBOUND_TEXT = "Explain why OCP keeps policy outside the model prompt.";

/**
 * Builds a demo channel that records outbound `message.sent` events in memory instead of
 * calling a real provider.
 *
 * OCP concept: a channel has a `source` (turns provider input into OCP events) and a `sink`
 * (delivers OCP events to the provider). Here both are pass-throughs.
 *
 * @param sent - Array that receives every event the sink delivers.
 * @returns A `ChannelDefinition` with provider name `example`.
 */
function createDemoChannel(sent: EventEnvelope[]): ChannelDefinition {
  return {
    provider: "example",
    sink: {
      provider: "example",
      send: (event) => {
        sent.push(event);
        return Promise.resolve({
          deliveredAt: new Date(),
          eventId: event.eventId,
          provider: "example",
        });
      },
    },
    source: {
      normalize: (input) => Promise.resolve(input as EventEnvelope),
      provider: "example",
    },
  };
}

const human = create(ActorRefSchema, { id: HUMAN_ID, type: ActorType.HUMAN });
const agent = create(ActorRefSchema, { id: AGENT_ID, type: ActorType.AGENT });

/** Outbound events captured by the demo channel sink. */
const dispatched: EventEnvelope[] = [];

/**
 * The OCP app. The rule-based policy has no rules, so the agent can only reply and cannot
 * request actions.
 */
const app = openChannel({
  agents: [
    {
      description: "Deterministic agent for the native TypeScript example",
      id: AGENT_ID,
      name: "Native TypeScript Agent",
      /** Replies with a fixed prefix plus the inbound text. No model is involved. */
      onMessage: async (context) => {
        await context.reply(`Deterministic response to: ${context.message.text}`);
      },
      skills: [{ id: "respond", name: "Respond to an OCP message" }],
    },
  ],
  channels: [createDemoChannel(dispatched)],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: createDemoEventStore(),
});

await app.start();
await app.ingest(
  messageReceived({
    actor: human,
    channel: create(ChannelRefSchema, { channelId: CHANNEL_ID, provider: "example" }),
    recipient: agent,
    text: INBOUND_TEXT,
  }),
);
await app.stop();

const [reply] = dispatched;
if (reply?.payload.case !== "messageSent") {
  throw new Error("The OCP app did not dispatch a message.sent reply");
}

// Print the agent card and the reply event so the output shows OCP identity and correlation.
console.log(
  JSON.stringify(
    {
      agentCard: app.agentCards().find((card) => card.id === AGENT_ID),
      correlationId: reply.correlationId,
      eventType: eventType(reply),
      reply: reply.payload.value.text,
    },
    null,
    2,
  ),
);
