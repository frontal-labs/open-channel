# Open Channel Protocol (OCP)

![Frontal Banner](./banner.jpg)

**Protocol for safe agent communication and approvals.**

OCP is an open communication layer for agents operating inside the channels where people already work: chat, email, calendars, and shared projects.

It standardizes the interaction contract around messages, tasks, approvals, escalation, handoff, policy, and audit events. The core protocol is provider-neutral; Slack, Teams, Google Chat, email, and other providers can implement adapters without changing the event model.

## Status

OCP 2.0 is a spec-first reference implementation. It includes protobuf schemas,
typed event builders, config-first TypeScript/Python/
Rust application facades, policy-controlled actions, source/sink channel
contracts, and at-least-once in-process processing.

Project links: [repository](https://github.com/frontal-labs/open-channel), [issues](https://github.com/frontal-labs/open-channel/issues), and [release notes](./CHANGELOG.md).

## Quickstart

Requirements: Node.js 22+, pnpm 10+, Buf, `protoc`, Python 3.11+, Rust stable, and a working git checkout.

```bash
pnpm install
pnpm generate
pnpm check
pnpm demo
pnpm cli -- version
```

The repository is orchestrated with Turborepo. `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` run through the package graph. Biome is the formatter/linter for TypeScript, Ultracite supplies its shared ruleset, Ruff formats and lints Python, and rustfmt/Clippy format and lint Rust.

Run `pnpm check:examples` to validate the opt-in framework integrations under
`examples/`. The native TypeScript, Python, and Rust examples run without model
credentials; framework examples document their own optional dependencies.

The demo runs this flow:

```text
message.received
  -> policy.allowed
  -> approval.requested
  -> approval.granted
  -> action.executed
```

## Repository layout

```text
.
├── proto/
│   ├── ocp/
│   │   ├── api/          The single EventEnvelope protobuf definition
│   │   └── types/        Shared domain protobuf definitions
│   ├── gen/              Generated TypeScript, Python, and Rust bindings
│   └── README.md         Schema and generated-code workflow
├── packages/
│   ├── protocol/         Generated types, builders, and serialization helpers
│   ├── runtime/          Event routing and approval lifecycle
│   ├── policy/           Rule-based policy reference implementation
│   ├── adapter/          Provider-neutral adapter contract
│   ├── core/             Shared event bus and identifier primitives
│   ├── testing/          Shared fixtures and helpers for TypeScript tests
│   └── demo/             Runnable end-to-end example
├── cli/                  `ocp` validation and inspection CLI
├── sdks/
│   ├── typescript/       TypeScript app facade, agent host, and developer API
│   ├── python/           Python app facade, agent host, and developer API
│   └── rust/             Rust app builder, agent host, and developer API
├── examples/             Native SDK and optional agent-harness integrations
├── skills/               OCP-specific instructions for agents and contributors
├── tests/                Cross-package Vitest conformance tests
├── docs/
│   ├── SPEC.md           Normative behavior and compatibility rules
│   └── DEVELOPMENT.md    Local development and agent SDK guide
├── skills.sh.json        skills.sh grouping and discovery metadata
├── turbo.json            Root Turborepo task graph
├── renovate.json         Dependency-update policy for code and examples
├── biome.json            Canonical Biome entrypoint and Ultracite presets
└── ultracite.json        Shared Biome formatting and lint configuration
```

```text
proto/ocp/api/       The single EventEnvelope protobuf definition
proto/ocp/types/     Shared domain protobuf definitions
proto/gen/           Generated TypeScript, Python, and Rust bindings
packages/protocol/   Generated types, builders, and serialization helpers
packages/runtime/    Event routing and approval lifecycle
packages/policy/     Rule-based policy reference implementation
packages/adapter/    Provider-neutral adapter contract
packages/core/       Shared event bus and identifier primitives
packages/testing/    Shared fixtures and helpers for TypeScript tests
cli/                 `ocp` validation and inspection CLI
sdks/typescript/     TypeScript app facade, agent host, and developer API
sdks/python/         Python app facade, agent host, and developer API
sdks/rust/           Rust app builder, agent host, and developer API
packages/demo/       Runnable end-to-end example
examples/            Native SDK and optional agent-harness integrations
skills/              OCP-specific instructions for agents and contributors
tests/               Cross-package Vitest conformance tests
skills.sh.json       skills.sh grouping and discovery metadata
docs/SPEC.md         Normative behavior and compatibility rules
docs/DEVELOPMENT.md  Local development and agent SDK guide
proto/README.md      Schema and generated-code workflow
turbo.json           Root Turborepo task graph
renovate.json        Dependency-update policy for code and examples
biome.json           Canonical Biome entrypoint and Ultracite presets
ultracite.json       Shared Biome formatting and lint configuration
```

## Protocol model

Every OCP event is an `EventEnvelope` with:

- stable event identity and protocol version;
- source, actor, recipient, channel, and conversation references;
- correlation, causation, and idempotency identifiers;
- a typed protobuf `oneof` payload;
- ProtoJSON support for logs, fixtures, and HTTP-oriented integrations.

The payload oneof is the event kind, and the friendly name is derived from it. For example, `message.received` contains a `messageReceived` payload, while `approval.granted` and `approval.denied` both use `approvalDecided` with different outcomes. `eventType(event)` returns the friendly name.

There is one envelope and one protocol version, `2.0`. Build events with the typed builders (`messageReceived`, `approvalRequested`, and so on) or `newEvent()`. Serialize with `toJson` / `fromJson` or `toBinary` / `fromBinary`.

## Safety semantics

- Policy is evaluated before an action is authorized.
- A denied action cannot proceed.
- An approval-required action creates an approval request rather than executing.
- Expired approvals emit both `approval.expired` and `escalation.triggered`.
- Registered high-level actions execute automatically after an approval grant;
  lower-level runtimes remain available for external executors.
- Event IDs make processing idempotent for replayed inbound events.
- The runtime exposes an append-only event store interface for durable implementations.
- `ChannelGateway.ingest()` handles inbound events and `ChannelGateway.dispatch()` sends outbound events through a registered provider adapter.
- `OpenChannelRuntime.decideApproval()` creates and processes a validated approval outcome without requiring callers to handcraft protobuf envelopes.

## A2A relationship

OCP uses compatible concepts such as actors, tasks, artifacts, correlation IDs, and typed events, but does not require A2A. OCP adds the enterprise-channel concerns that are specific to human and agent communication: recipients, shared channels, approval routing, escalation, handoff, and auditability.

## Contributing

The canonical schema lives under `proto/`. Run `pnpm generate` after changing it, then run `pnpm check`. New provider integrations should implement `ChannelSource` and/or `ChannelSink` and translate provider-native events into OCP envelopes without leaking provider-specific fields into the core payloads. Application code should prefer `openChannel()` from `ocp-sdk`.

Use `pnpm fix` for safe formatting and lint fixes. Package-level task configuration is inherited from the root `turbo.json`; each package also contains a local `turbo.json` so ownership and future task overrides stay close to the package.
