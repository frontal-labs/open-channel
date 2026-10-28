# Native Rust OCP

This example uses the local Rust SDK crate (`@openchannelprotocol/sdk`) to run a complete,
deterministic OCP application: an agent receives a `message.received` event,
replies with a `message.sent` event, and requests a refund action that is held
for human approval until the designated approver grants it.

No model, provider, or credential is required.

## Prerequisites

- A Rust toolchain with Cargo (the example uses edition 2021; any recent stable toolchain works)
- A checkout of this repository. The example depends on the local SDK at `sdks/rust`.

## Environment variables

None. The example reads no environment variables.

## Run

From the repository root:

```bash
cargo run --manifest-path examples/native-rust/Cargo.toml
cargo test --manifest-path examples/native-rust/Cargo.toml
```

Expected output of the run:

```text
delivered: message.sent -> Deterministic response to: Explain why OCP keeps policy outside the model prompt.
handled: true
replies: 1
action: refund is held until human:finance grants it
rejected: grant from a non-designated approver
granted: {"status":"refunded","input":{"amount":250,"currency":"USD"}}
audit: message.received, message.sent, approval.requested, approval.granted, action.executed
protobuf: approval.requested round-trips
```

The output contains no generated IDs or timestamps, so it is identical on every run. The unit
tests cover the reply and the approval gate, so `cargo test` is also deterministic.

## OCP mapping

```text
example channel -> OCP message.received (actor, recipient, channel, conversation)
  -> AgentDefinition handler: context.reply(...)      -> message.sent -> ConsoleSink
  -> AgentDefinition handler: context.request("refund") -> RefundPolicy
       -> approval.requested (held)
       -> app.approve(approval, human:finance)         -> approval.granted
       -> refund action handler                        -> action.executed
```

- `AgentDefinition` is the agent host registration. Its handler only builds replies and
  action requests; it never executes the refund.
- `ConsoleSink` is the outbound channel. It prints each delivered event instead of
  calling a real service.
- `RefundPolicy` decides whether an action is blocked, allowed, or held for approval.
  Refunds are held; any other action type is blocked.
- `OpenChannel::approve` takes the approval ID and an approver. Only the designated
  approver (`human:finance`) is accepted. A different actor is rejected and the refund
  stays held.

## Safety boundary

An approval request is not execution. The refund handler runs only after the
designated approver grants the held action, and the run records `approval.granted`
followed by `action.executed` in the audit trail. The model-facing handler never
decides authorization.

## Files

- `src/main.rs`: application wiring, the agent, the policy, the sink, and the
  demonstration run. It also contains two unit tests (`cargo test`).
- `Cargo.toml`: depends on the local SDK through a path dependency
  (`../../sdks/rust`), so the example stays aligned with the SDK without publishing
  or joining the root workspace.
