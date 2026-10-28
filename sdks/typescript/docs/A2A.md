# @openchannelprotocol/sdk/a2a

An A2A (agent-to-agent) channel for OCP. Inbound messages from a peer agent become OCP
`message.received` events, and outbound `message.sent` events go back to the peer through a transport
you supply. Task and context IDs are carried through, so multi-turn conversations stay correlated.

## Where it sits in the OCP flow

```text
peer agent request -> receive() -> OCP message.received (actor type AGENT)
  -> harness -> OCP message.sent -> A2A transport -> peer agent response
```

## Install

```sh
pnpm add @openchannelprotocol/sdk
```

## Quickstart

```ts
import { a2aChannel } from "@openchannelprotocol/sdk/a2a";
import { RuleBasedPolicyEngine } from "@openchannelprotocol/sdk";
import { postgresStore } from "@openchannelprotocol/sdk/postgres";
import { openChannel } from "@openchannelprotocol/sdk";

const app = openChannel({
  channels: [
    a2aChannel({
      localAgentId: "agent:billing",
      transport: {
        // Deliver one message to the peer. Use your A2A client here.
        sendMessage: async (input) => ({ externalId: `a2a:${input.taskId ?? "new"}` }),
      },
    }),
  ],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: postgresStore({ client: pool }), // pool: your PostgresClient, see POSTGRES.md
});

await app.start();
await app.receive("a2a", {
  id: "msg-1",
  contextId: "ctx-42",
  message: {
    sender: { id: "agent:support" },
    parts: [{ text: "Refund order 1001" }],
  },
});
```

## Inbound and outbound

- `receive()` accepts `message.parts[].text` (joined with newlines), or `message.text`, or a
  top-level `text`. Parts that carry no text are ignored.
- The sender ID comes from `message.sender.id` (or `name`, or `agent.id`). Without one, the sender is
  `remote-agent`.
- `contextId` (or `context_id`) becomes the conversation. `taskId` (or `task_id`) becomes the thread.
- Messages from `localAgentId` are dropped, so an agent never answers its own echoed messages.
- The sink sends only `message.sent` events and returns a receipt with the peer's `externalId`.

## Options

- `recipient`: the local agent that receives inbound messages. AgentHost routes only by recipient, so
  without it the message reaches no agent.
- `localAgentId`: this agent's own ID, used for loop prevention.
- `transport.sendMessage`: sends one message to the peer. Receives `contextId`, `taskId`, `text`, the
  idempotency key, and an abort signal.
- `AgentCardRegistry`: the type for advertising agent cards to peers through
  `app.agentCards()`.

## Safety boundary

Any peer that can reach `receive()` can send a message to the recipient agent, so authenticate the
transport before calling it (mutual TLS, signed requests, or your A2A gateway's auth). Inbound
messages are not trusted; policy still decides what the agent may do in response.

## Environment

None in the package. Your transport supplies endpoints and credentials.

## Tests

```sh
pnpm --filter @openchannelprotocol/sdk test
```

The tests use fake transports and need no network access.
