# OCP API reference

OCP 2.0 has one event envelope, one protocol version (`2.0`), and one package version (`2.0.0`) for every package, SDK, and example. This page is the canonical vocabulary. TypeScript uses camelCase; Python and Rust use snake_case. The names are otherwise identical.

## Events

An event is an `EventEnvelope`. Its payload `oneof` is the event kind, so the envelope stores no separate type string.

| Concept                              | TypeScript                                                                              | Python                                                                                       | Rust                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Envelope                             | `EventEnvelope`                                                                         | `EventEnvelope`                                                                              | `EventEnvelope`                                                                              |
| Friendly name (`"approval.granted"`) | `eventType(event)`                                                                      | `event_type(event)`                                                                          | `event.event_type()`                                                                         |
| Build any event                      | `newEvent({ payload, ... })`                                                            | `new_event(payload=..., ...)`                                                                | `EventEnvelope::new(payload)`                                                                |
| Typed builders                       | `messageReceived`, `messageSent`, `approvalRequested`, `actionExecuted`, `actionFailed` | `message_received`, `message_sent`, `approval_requested`, `action_executed`, `action_failed` | `message_received`, `message_sent`, `approval_requested`, `action_executed`, `action_failed` |
| Validate                             | `validateEvent(event)`                                                                  | `validate_event(event)`                                                                      | `event.validate()`                                                                           |
| JSON (ProtoJSON)                     | `toJson(event)`, `fromJson(value)`                                                      | `to_json(event)`, `from_json(value)`                                                         | `event.to_json()`, `EventEnvelope::from_json(&value)`                                        |
| Binary protobuf                      | `toBinary(event)`, `fromBinary(bytes)`                                                  | `to_binary(event)`, `from_binary(data)`                                                      | `event.to_binary()`, `EventEnvelope::from_binary(&bytes)`                                    |

`fromJson` and `fromBinary` validate untrusted input. Binary decoding needs no version argument because there is only one envelope.

Approval lifecycle events (`approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`) are produced only by the runtime. External callers may not submit them.

## Application

One function builds an OCP application.

```ts
import { ocp } from "ocp-sdk";

const app = ocp({
  policy,                 // required
  store,                  // required: durable EventStore
  agents: [...],
  actions: [...],
  channels: [...],
  approver,               // default approver for approval requests
  approvalTimeoutMs: 60_000,
  concurrency: 8,
  hooks: {...},
  runtimeActor,           // optional
  clock,                  // optional, for tests
  logger,                 // optional: ctx.logger; defaults to consoleLogger
});
```

| Concept                          | TypeScript                                          | Python                                      | Rust                                     |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Build                            | `ocp(options)`                                      | `ocp(**options)`                            | `Ocp::builder()...build()`               |
| Type                             | `Ocp`                                               | `Ocp`                                       | `Ocp`                                    |
| Lifecycle                        | `start()`, `stop({ timeoutMs? })`                   | `start()`, `stop(timeout_ms=...)`           | `start()`, `stop()`                      |
| Intake from a provider           | `receive(provider, input, meta?)`                   | `receive(provider, input, meta=None)`       | `receive(provider, input, meta)`         |
| Intake of a built event          | `ingest(event)`                                     | `ingest(event)`                             | `ingest(event)`                          |
| Approve / deny                   | `approve(id, by, reason?)`, `deny(id, by, reason?)` | `approve(id, by, reason=None)`, `deny(...)` | `approve(id, by, reason)`, `deny(...)`   |
| Observe events                   | `on(eventType, handler)`                            | `on(event_type, handler)`                   | `on(event_type, handler)`                |
| Discovery                        | `agentCards()`                                      | `agent_cards()`                             | `agent_cards()`                          |
| Register later                   | `addAgent`, `addAction`, `addChannel`               | `add_agent`, `add_action`, `add_channel`    | `add_agent`, `add_action`, `add_channel` |
| Audit store                      | `app.store`                                         | `app.store`                                 | `app.store()`                            |
| Escape hatches (TypeScript only) | `app.runtime`, `app.gateway`, `ctx.runtime`         | not provided                                | not provided                             |

## Recovery

On `start()`, an app rebuilds its approval state from the event store. Unresolved approval requests are tracked again and their expiry is rescheduled. A deadline that passed while the process was down expires immediately. A granted approval whose action has no terminal event runs once. Restarting with the same store and the same registered actions is therefore safe.

## Actions

An action is a typed, policy-controlled operation.

```ts
const sendReply = action({
  type: "send_customer_reply",
  validate: (input) => ...,          // unknown -> TInput, throws on bad input
  execute: async (input, ctx) => ..., // ctx.actor, ctx.event, ctx.runtime, ctx.request
});
```

`action()` replaces `defineAction()`. A `request` returns one of four statuses: `executed`, `approval_required`, `blocked`, `failed`.

## Agents

```ts
agents: [
  {
    id: "agent:support",
    name: "Support Agent",
    skills: [{ id: "triage", name: "Triage" }],
    async onMessage(ctx) {
      await ctx.reply("On it.");
      const result = await ctx.request(
        "send_customer_reply",
        { ticketId: "t1" },
        {
          approver,
          reason: "Customer-facing reply",
        },
      );
    },
  },
];
```

The agent context has one flat surface:

| Field or method                                | Meaning                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ctx.message`                                  | The `MessageReceived` payload                                                                                              |
| `ctx.event`                                    | The raw inbound `EventEnvelope`                                                                                            |
| `ctx.agent`, `ctx.conversation`, `ctx.channel` | Routing identity                                                                                                           |
| `ctx.reply(text, opts?)`                       | Send a reply through the channel sink                                                                                      |
| `ctx.request(type, input, opts?)`              | Request an action (policy applies)                                                                                         |
| `ctx.logger`                                   | Structured logger. Defaults to `consoleLogger` (warn and error only); Python and Rust default to stderr for warn and error |
| `ctx.runtime`                                  | Escape hatch to the runtime                                                                                                |

## Channels

A channel is a provider adapter with an inbound `source` and an outbound `sink`.

```ts
channels: [{ provider: "slack", source: slackSource, sink: slackSink }];
```

Providers translate their native payloads into `message.received` events. Provider fields live in `channel` and `extensions`, never in core payloads.

## Versioning

- Protocol version: `2.0` (`PROTOCOL_VERSION` in TypeScript, `PROTOCOL_VERSION` in Python, `PROTOCOL_VERSION` in Rust).
- Package versions: `2.0.0` for every workspace package, SDK, and example.
- Protobuf: package `ocp.api` (envelope) and `ocp.types` (domain messages). Field numbers are stable. `event_type` (field 2) is reserved.
