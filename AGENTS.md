# OCP repository agent instructions

## Stack

- TypeScript packages are orchestrated with pnpm and Turborepo.
- Protobuf schemas live in `proto/ocp`; generated bindings live in `proto/gen`.
- Python and Rust SDKs use their native test/build tooling.
- Biome/Ultracite owns JavaScript, TypeScript, JSON, and YAML formatting/linting.

## Verification

Run `pnpm check` from the repository root. For a faster configuration-only check, use `pnpm check:config && pnpm check:docs`.

## Repository boundaries

- Do not edit generated files under `proto/gen` manually.
- Keep provider-specific behavior in adapters and in the SDK provider subpaths (`sdks/typescript/src/<provider>/`).
- Keep runtime policy and protocol packages provider-neutral.
- Public TypeScript APIs must be exported through the owning package's `src/index.ts`.
- Add a Changeset for user-visible package changes.

## Tooling

- `pnpm doctor` checks local tool availability and repository structure.
- `pnpm generate` regenerates TypeScript, Python, and Rust bindings.
- `pnpm changeset` creates a release note for package changes.
- Husky runs lint-staged checks before commits and Commitlint validates commit messages.

## Project contract

OCP is a provider-neutral protocol for agent, human, and system communication.
The protocol owns event identity, correlation, payload semantics, policy
signals, approvals, escalation, handoff, and audit-oriented history. A provider
adapter owns transport details; an agent harness owns model and tool execution.

Keep those boundaries explicit:

- `proto/ocp` is the canonical wire contract. Never edit generated files under
  `proto/gen` by hand.
- `packages/protocol` owns event construction, validation, ProtoJSON, and
  generated type exports.
- `packages/runtime` owns event processing, approvals, expiry, escalation, and
  the event-store boundary.
- `packages/adapter` owns channel transport contracts and provider adapters.
- `sdks/{typescript,python,rust}` expose ergonomic agent-host APIs.
- `examples/` contains opt-in integrations and must not add framework
  dependencies to the core workspace.
- `skills/` contains reusable OCP-specific agent instructions.

Provider SDKs, model SDKs, credentials, and framework-specific message types
belong in an adapter or example. Do not leak them into protocol packages.

## Working agreements

1. Read the relevant skill in `skills/` before changing protocol, policy,
   adapter, agent, test, or example behavior.
2. Preserve protobuf field numbers and package names. Add fields; do not
   renumber or reuse fields on the 2.0 line. Field 2 (`event_type`) is reserved.
3. Export public TypeScript APIs explicitly from the owning package's
   `src/index.ts`.
4. Use stable `agent:`, `human:`, `system:`, `channel:`, and `conversation:`
   identifiers in fixtures and examples.
5. Never treat an approval request as execution. An approved action still
   requires an explicit executor and action result event.
6. Keep examples deterministic where possible. Network calls, model calls,
   live providers, and credentials must be opt-in.
7. Add a Changeset for user-visible package, protocol, or released example
   changes.
8. Never commit secrets, `.env` files, build output, `target/`, or framework
   caches.
9. Name Markdown files with uppercase `SNAKE_CASE.md`; conventional single-token
   names such as `README.md`, `LICENSE.md`, and `SKILL.md` remain valid.

## Verification

Use the narrowest useful command while iterating:

```bash
pnpm check:config && pnpm check:docs
pnpm check:examples
pnpm proto:lint
pnpm --filter <package> test
```

Before opening a pull request, run `pnpm fix`, `pnpm check`, and `pnpm doctor`.
The full check regenerates bindings, validates Buf, runs TypeScript lint/build/
typecheck, executes workspace/root tests, and tests the Python and Rust SDKs.

## Example integrations

Every example should make the OCP boundary visible:

```text
provider/harness input -> OCP message.received -> harness execution
  -> OCP message.sent / policy / approval events -> provider output
```

Document installation, environment variables, run commands, the OCP-to-harness
mapping, and the safety/approval boundary. Keep framework dependencies inside
the example's own manifest or requirements file.

## Protocol changes

Read `docs/SPEC.md` and `skills/@openchannelprotocol/protocol/SKILL.md`, edit only canonical
schemas and hand-written helpers, update all language bindings, run
`pnpm generate`, inspect the generated diff, and then run Buf, typecheck, and
test verification. Do not claim a schema change is complete while generated
bindings or protocol validation are stale.

## Repository tooling

- `pnpm check:examples` verifies example layout and required DX documents.
- `pnpm changeset` creates release notes.
- `pnpm python:lint` and `pnpm python:format:check` validate Python code with Ruff.
- `pnpm rust:lint` and `pnpm rust:format:check` validate Rust code with Clippy and rustfmt.
- `pnpm release:version` synchronizes Changesets versions across the published SDKs.
- Husky runs staged formatting/linting and Commitlint validates commit titles.
- Renovate updates pnpm, Cargo, Python, GitHub Actions, and example
  dependencies while keeping updates reviewable.
