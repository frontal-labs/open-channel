# ocp-runtime

Low-level OCP runtime for event processing, policy evaluation, approvals, escalation, audit storage, and channel dispatch. Application developers can use `openChannel()` from `@openchannelprotocol/sdk` as the lifecycle-managed facade.

## Main APIs

- `OpenChannelRuntime` processes events and manages approval lifecycles.
- `ManualClock` makes timeout behavior deterministic in tests.
- `ChannelGateway` separates inbound ingestion from provider dispatch.
- `InMemoryEventStore` provides a local append-only event store.
- `EventStore.appendIfAbsent()` and optional query methods support idempotent durable implementations.

Durable stores and provider integrations can implement the exported interfaces without changing the event model.
