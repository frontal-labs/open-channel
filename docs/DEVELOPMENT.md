# Development guide

OCP is a pnpm workspace managed by Turborepo. TypeScript package `index.ts` files are export-only entrypoints; implementation modules stay next to the APIs they provide. Python and Rust SDKs use their native package layouts.

## Local workflow

```bash
pnpm install
pnpm check
pnpm demo
pnpm cli -- version
pnpm sdk:test
```

`pnpm check` regenerates and validates protobuf bindings, runs Ultracite/Biome linting, builds every package, typechecks every package and the root test project, then runs the package test graph and root Vitest integration suite.

For a fast documentation and configuration check, run:

```bash
pnpm check:config
pnpm check:docs
pnpm check:examples
```

## Tooling commands

```bash
pnpm build       # Turbo package builds in dependency order
pnpm typecheck   # package and root TypeScript checks
pnpm test        # package tests followed by root Vitest integration tests
pnpm lint        # package lint tasks followed by the root check
pnpm format      # package and root Ultracite fixes
pnpm fix         # safe repository-wide Ultracite fixes
```

Biome is configured in `biome.json`; it extends the Ultracite presets and the shared project settings in `ultracite.json`. The editor configuration uses the Biome extension as the TypeScript formatter and enables format-on-save.

`pnpm generate` produces all language bindings: Buf/protoc-gen-es writes TypeScript, `protoc` writes Python, and the Rust SDK's `prost-build` writes Rust modules. The canonical schema lives in `proto/ocp`, with the envelope in `proto/ocp/api` and shared domain messages in `proto/ocp/types`.

The shared `@openchannel/testing` package provides deterministic OCP fixtures, event inspection, async coordination, buffered CLI I/O, and in-memory state doubles. Package-local tests and the root integration suite use the same Vitest configuration and aliases.

The published SDK distributions are all named `ocp-sdk` in their registries:
install with `pnpm add ocp-sdk`, `python -m pip install ocp-sdk`, or
`cargo add ocp-sdk`. The Rust and Python import identifier is `ocp-sdk`.

Public TypeScript entrypoints use explicit named exports, and shared failures are represented by `@openchannel/core` error classes. Validate untrusted event JSON with `fromJson()` or the exported Zod schemas before handing it to an agent or runtime.

## Adding an agent

For new applications, use the config-first `openChannel` facade. It composes the runtime, agent host, channel source/sink registration, action registry, lifecycle, and hooks. Use `AgentHost` directly when you need lower-level composition. This keeps agent discovery and execution separate from channel transport, similar to the useful parts of A2A without importing an A2A transport requirement.

```ts
import { openChannel } from "ocp-sdk";

const app = openChannel({
  policy,
  agents: [
    {
      id: "agent:triage",
      name: "Triage Agent",
      skills: [{ id: "triage", name: "Triage" }],
      async onMessage(ctx) {
        await ctx.reply("I am looking into this.");
      },
    },
  ],
});
await app.start();
```

Use `agentCards()` for discovery, `ctx.request()` for typed
policy-controlled actions, and `ctx.reply()` for channel-aware responses.
Implement provider integrations as a `ChannelSource` for inbound normalization
and a `ChannelSink` for outbound delivery.
