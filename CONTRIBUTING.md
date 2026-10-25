# Contributing to OCP

## Setup

```bash
pnpm install
pnpm generate
pnpm check
```

## Tooling

- Turborepo coordinates package tasks and dependency ordering.
- Biome formats and lints source files.
- Ultracite provides the shared Biome preset and CLI.
- Vitest runs the root conformance suite.
- Buf validates and generates protobuf artifacts.

Use `pnpm fix` before opening a change. Use `pnpm check` before submitting it.

## Changes

Keep protocol changes in `proto/ocp/api` or `proto/ocp/types` and update all generated bindings with `pnpm generate`. Add tests under `tests/` for TypeScript event semantics and under the relevant SDK's native test directory for language-specific behavior. TypeScript package public APIs must be exported through that package's `src/index.ts`.

## Before you start

Read [AGENTS.md](./AGENTS.md), [the protocol specification](./docs/SPEC.md),
[the security policy](./SECURITY.md), and the narrowest matching skill under
[`skills/`](./skills/). Open an issue first for wire-contract, public SDK,
provider-semantic, or security-model changes; small documentation, test, and
example fixes can usually go directly to a pull request.

## Where changes belong

- Protocol and compatibility: `proto/ocp`, `packages/protocol`, and the spec.
- Runtime and approvals: `packages/runtime` and `packages/policy`.
- Provider transport: `packages/adapter` or `sdks/typescript/src/<provider>/` (shipped as `ocp-sdk/<provider>`).
- Agent hosts: the matching TypeScript, Python, or Rust SDK.
- Framework integrations: `examples/<framework>-<language>/`.
- Shared fixtures: `packages/testing` or root `tests/`.
- Generated output: run `pnpm generate`; never hand-edit `proto/gen`.

## Example checklist

Each framework example must include a local README, a dependency manifest, an
OCP inbound and outbound event, credential guidance, a deterministic/dry-run
path where practical, and explicit handling for failures and
approval-required actions. Framework dependencies must remain opt-in.

## Pull requests

Include the problem statement, implementation summary, test commands/results,
protocol or security implications, and a note when generated files or release
metadata changed. Use Conventional Commits such as:

```text
feat(protocol): add handoff completion metadata
fix(runtime): prevent duplicate approval transitions
docs(examples): add LangChain Python bridge
```

CI must pass before merge. Maintainers may request a Changeset, conformance
coverage, or a design note for cross-package changes.
