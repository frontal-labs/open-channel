# @openchannelprotocol/sdk

The Rust distribution of the OpenChannel Protocol (OCP) is published as `@openchannelprotocol/sdk` on crates.io.
Rust imports use the identifier `@openchannelprotocol/sdk`. It provides one event envelope, one protocol version
(`PROTOCOL_VERSION`, `2.0`), an agent host with A2A-like agent cards, and the `OpenChannel` application.

```bash
cargo add @openchannelprotocol/sdk
```

## Build an application

```rust
use openchannel_sdk::{AgentCard, AgentDefinition, Hooks, MemoryEventStore, OpenChannel,
    OpenChannelOptions};

let app = OpenChannel::new(OpenChannelOptions {
    agents: vec![AgentDefinition::new(
        AgentCard::new("agent:support", "Support Agent"),
        |context| {
            context.reply("I am looking into this.");
            Ok(())
        },
    )],
    actions: vec![],
    channels: vec![],
    policy: Box::new(my_policy),            // ActionPolicy; required for actions to run
    store: Arc::new(MemoryEventStore::default()), // optional; in-memory by default
    approver: None,
    approval_timeout_ms: 60_000,
    concurrency: usize::MAX,
    hooks: Hooks::default(),
    clock: None,
    logger: None,
    runtime_actor: None,
});

app.start()?;
app.ingest(event)?;                          // or app.receive(provider, input, &metadata)
app.approve("action:1:approval", &approver, "ok")?;
app.stop()?;
```

`OpenChannel` methods: `start`, `stop`, `ingest`, `receive`, `approve`, `deny`, `on`, `agent_cards`,
`add_agent`, `add_action`, `add_channel`, `events`, `concurrency`.

`on("approval.granted", |event| ...)` observes events of one name as they are accepted or emitted.

## Events

There is one envelope. Its payload is the event kind, and `event_type()` derives the dot-separated name:

```rust
use openchannel_sdk::{approval_decided, message_received, ApprovalOutcome, EventEnvelope};

let event = message_received("hello");
assert_eq!(event.event_type(), "message.received");

let json = event.to_json()?;                  // ProtoJSON
let same = EventEnvelope::from_json(&json)?;

let bytes = event.to_binary()?;               // protobuf; no version argument
let decoded = EventEnvelope::from_binary(&bytes)?;

let decision = approval_decided("approval:1", ApprovalOutcome::Granted, &approver, "ok");
assert_eq!(decision.event_type(), "approval.granted");
```

Every encode and decode validates the envelope. Binary output is byte-identical to the TypeScript
and Python SDKs; `tests/parity.rs` checks that against the shared fixture in
`packages/protocol/tests/fixtures`.

## Protobuf

The build generates Rust bindings for `proto/ocp` into `src/generated`. The envelope is
`ocp::api::EventEnvelope`; domain messages are `ocp::types`. Field numbers are stable, and
`event_type` (field 2) is reserved.

## Development

```bash
cargo test --manifest-path sdks/rust/Cargo.toml
cargo clippy --manifest-path sdks/rust/Cargo.toml --all-targets --all-features -- -D warnings
```

## Recovery, audit, and logging

- **Restart recovery.** `start()` restores approval state from the store. Unresolved approvals are tracked again, a deadline that passed while the process was down expires at start, and a granted approval with no terminal action event runs once. Only decisions written by the runtime, or by the designated approver before the source change, are honoured.
- **Audit.** `app.store()` returns the event store for queries.
- **Logging.** `ctx.logger()` has four levels. Warnings and errors go to stderr by default. Pass a logger to the builder to replace it.
