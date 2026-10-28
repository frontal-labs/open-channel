# @openchannelprotocol/open-channel

## 2.2.1

### Patch Changes

- [#35](https://github.com/frontal-labs/open-channel/pull/35) [`3f7adef`](https://github.com/frontal-labs/open-channel/commit/3f7adef311c87176fac1bd57fd814fce3840319f) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Make `@openchannelprotocol/sdk` self-contained. The published type declarations no longer import the internal `ocp-*` workspace packages or the `@openchannelprotocol` npm scope, and those packages are no longer published. Consumers no longer need any `@openchannelprotocol` scope configuration in `.npmrc`, and they get real types instead of `any`. The public API is unchanged: the same names are exported from the same subpaths.

  Also fixes the published package:

  - `@openchannelprotocol/sdk/openchannel` now ships its type declarations, which were missing from 2.2.0.
  - Build output from older releases (such as the removed `opa` adapter) is no longer packed.
  - `zod` is no longer an optional peer dependency, because it is bundled and nothing requires it at install time.

## 2.2.0

### Minor Changes

- [#33](https://github.com/frontal-labs/open-channel/pull/33) [`a3037af`](https://github.com/frontal-labs/open-channel/commit/a3037af2c5fb75c8de7a331e33c4fe47940b0867) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Rename the OPA policy adapter subpath from `@openchannelprotocol/sdk/opa` to `@openchannelprotocol/sdk/openchannel`. Replace the `opaPolicy`, `OpaPolicyEngine`, and `OpaTransport` exports with `openchannelPolicy`, `OpenchannelPolicyEngine`, and `OpenchannelTransport`. Policy IDs change from `opa:*` to `openchannel:*`, and the provider name changes from `opa` to `openchannel`. Update imports and any code that matches on those IDs. The adapter still evaluates Open Policy Agent decisions through your transport.

## 2.1.0

### Minor Changes

- [#23](https://github.com/frontal-labs/open-channel/pull/23) [`9f57ea5`](https://github.com/frontal-labs/open-channel/commit/9f57ea5025130cb78ef19a382a330fcf39bf75aa) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Fold every channel and capability extension into the `@openchannelprotocol/sdk` SDK as subpath imports: `@openchannelprotocol/sdk/slack`, `@openchannelprotocol/sdk/teams`, `@openchannelprotocol/sdk/google-chat`, `@openchannelprotocol/sdk/email`, `@openchannelprotocol/sdk/whatsapp`, `@openchannelprotocol/sdk/a2a`, `@openchannelprotocol/sdk/calendar`, `@openchannelprotocol/sdk/mcp`, `@openchannelprotocol/sdk/directory`, `@openchannelprotocol/sdk/otel`, `@openchannelprotocol/sdk/opa`, `@openchannelprotocol/sdk/cedar`, and `@openchannelprotocol/sdk/postgres`.

  Exports drop the `create` prefix: `createSlackChannel` is now `slackChannel`, `createPostgresEventStore` is now `postgresStore`, and so on. The SDK also re-exports `RuleBasedPolicyEngine`, `createActor`, `ActorType`, `ActorRefSchema`, and `ChannelRefSchema` so applications import from `@openchannelprotocol/sdk` alone. `zod` is an optional peer, required only by `@openchannelprotocol/sdk/calendar` and `@openchannelprotocol/sdk/mcp`.

- [#20](https://github.com/frontal-labs/open-channel/pull/20) [`377b8bc`](https://github.com/frontal-labs/open-channel/commit/377b8bc5ef9d5de09f151ccb2db4ffb7a7a09e21) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Rename the TypeScript SDK package to `@openchannelprotocol/sdk`. Install with `pnpm add ocp-sdk` and import from `"@openchannelprotocol/sdk"`. The Python package is now `@openchannelprotocol/sdk` (imported as `@openchannelprotocol/sdk`), and the Rust crate is now `@openchannelprotocol/sdk`.

## 1.0.0

### Minor Changes

- [`ba50acf`](https://github.com/frontal-labs/open-channel/commit/ba50acfa54268c84ccc60e9c73d8956988dd7650) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Add the config-first OCP application facade, split channel source/sink contracts, typed action registration and execution, lifecycle hooks, per-conversation handling, and the versioned v2 event envelope helpers.

- [#7](https://github.com/frontal-labs/open-channel/pull/7) [`232c8bf`](https://github.com/frontal-labs/open-channel/commit/232c8bf7134a950b5a7c5697d7472bda0e77fac4) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Rename the project to OpenChannel Protocol (OCP). The SDK distributions are now `open-channel` on crates.io and PyPI and `@openchannelprotocol/open-channel` on npm (npm requires the scope for this name); the Python import is `open_channel` and the Rust crate is `open_channel`. The CLI is `@openchannelprotocol/open-channel-cli` with the `ocp` binary. The internal packages moved from `@acp/*` to `@openchannelprotocol/open-channel-*`.

  Migration: rename imports (`createAcp` becomes `createOcp`, `AcpRuntime` becomes `OcpRuntime`, `AcpError` becomes `OcpError`, and the Python `acp` module becomes `open_channel`). Rename `ACP_*` environment variables and exported constants to `OCP_*` (for example `OCP_POSTGRES_URL` and `OCP_PROTOCOL_VERSION`), and the `ACP_*` error codes to `OCP_*`.

  Wire and storage identifiers also change: the protobuf packages are `ocp.v1` and `ocp.v2` (previously `acp.v1` and `acp.v2`), telemetry attributes and extension keys use the `ocp.*` prefix (for example `ocp.provider`), and the PostgreSQL tables are `ocp_events` and `ocp_actions`. Existing v0.1 stored events, telemetry dashboards, and database tables need a migration, and consumers that match the old `acp.*` keys or type names must be updated.

  Approval authority: the Python SDK's `approve()` and `deny()` now require the approver and reject any actor other than the designated approver with `AuthorizationError` (`OCP_AUTHORIZATION`). The designated approver comes from `PolicyDecision.approver`, or from the new `default_approver` app option, which defaults to the runtime actor. Previously any caller could approve or deny a pending action. A rejected attempt leaves the approval pending. The TypeScript runtime already enforced this check.

- [#1](https://github.com/frontal-labs/open-channel/pull/1) [`315729b`](https://github.com/frontal-labs/open-channel/commit/315729bbcc8cd2ecf28edc928c1d5741ada7e424) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Remove in-memory implementations from production packages. `eventStore` is now required for `OcpRuntime` and `createOcp()`; there is no implicit storage. The in-memory event bus, channel adapter, and event store moved to `@openchannelprotocol/open-channel-testing` as `createTestEventBus()`, `createTestChannelAdapter()`, and `createTestEventStore()`. The test channel provider is renamed from `"memory"` to `"test"`.

- [#1](https://github.com/frontal-labs/open-channel/pull/1) [`29b2f5f`](https://github.com/frontal-labs/open-channel/commit/29b2f5ff72f82ab130f0f66e9bb38b87ca7ef913) Thanks [@gabrielvfonseca](https://github.com/gabrielvfonseca)! - Unify OCP v0.1 and v0.2 event handling behind one API. `createEvent`, the typed builders (`messageReceived`, `messageSent`, `approvalRequested`, `actionExecuted`, `actionFailed`), and the serialization helpers accept a `protocolVersion` of `"0.1"` (default) or `"0.2"`. `eventTypeOf()` derives the event name for either version. The separate `createV2Event`, `v2EventType`, and `v2Event*` helpers are removed.

  Application handlers registered with `app.on()` are now isolated: a handler that throws is reported through `hooks.onError` instead of interrupting other handlers. `app.stop()` keeps the host attached while draining so in-flight conversations still deliver their replies. The PostgreSQL event store rejects v0.2 envelopes because the runtime persists v0.1 events.

  Binary encoding is real protobuf for every event kind in both versions. A shared parity fixture (`packages/protocol/tests/fixtures/event-parity.json`) is decoded and re-encoded byte-identically by the TypeScript, Python, and Rust SDKs.

### Patch Changes

- Updated dependencies [[`ba50acf`](https://github.com/frontal-labs/open-channel/commit/ba50acfa54268c84ccc60e9c73d8956988dd7650), [`232c8bf`](https://github.com/frontal-labs/open-channel/commit/232c8bf7134a950b5a7c5697d7472bda0e77fac4), [`315729b`](https://github.com/frontal-labs/open-channel/commit/315729bbcc8cd2ecf28edc928c1d5741ada7e424), [`2f6ca43`](https://github.com/frontal-labs/open-channel/commit/2f6ca432c96dc138713a1b167f2496ed3a680ab5), [`29b2f5f`](https://github.com/frontal-labs/open-channel/commit/29b2f5ff72f82ab130f0f66e9bb38b87ca7ef913)]:
  - @openchannelprotocol/open-channel-adapter@1.0.0
  - @openchannelprotocol/open-channel-core@1.0.0
  - @openchannelprotocol/open-channel-protocol@1.0.0
  - @openchannelprotocol/open-channel-runtime@1.0.0
  - @openchannelprotocol/open-channel-policy@1.0.0
