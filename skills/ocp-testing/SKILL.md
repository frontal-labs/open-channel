---
name: ocp-testing
description: Add and maintain deterministic OCP Vitest coverage with shared fixtures, event selectors, clocks, state doubles, and workspace validation.
---

# OCP testing

Use this skill when adding tests, creating test doubles, diagnosing a failing
event flow, or validating changes across the pnpm/Turborepo workspace.

## Test layers

- Put behavior-specific tests next to the owning package in `tests/`.
- Put cross-package contract tests in the root [`tests`](../../tests)
  directory.
- Use Vitest through the repository configuration in
  [`vitest.config.ts`](../../vitest.config.ts); do not create a competing test
  runner or package-local configuration unless the package truly needs one.
- Keep `src/index.ts` export-only and test public exports when an API surface
  changes.

## Shared helpers

Import from `ocp-testing` instead of recreating fixtures:

- `createTestHuman`, `createTestAgent`, `createTestActor` for stable identities;
- `createTestChannel`, `createTestConversation`, and `createTestEvent` for
  valid protocol envelopes;
- `createTestAction` and message helpers for typed payloads;
- `eventsOfType`, `findEvent`, `requireEvent`, and `eventTypes` for event
  assertions;
- `createTestRecorder`, `createTestEventStore`, and `createTestEventBus` for
  observable state doubles;
- `ManualClock` from `ocp-runtime` for deadlines and timers;
- `createDeferred`, `waitFor`, and buffered test I/O for coordination without
  real sleeps or terminal side effects.

Prefer asserting public outcomes: event types and payload values, runtime
statuses, adapter sends, agent cards, and shared error codes. Avoid asserting
private maps, generated implementation details, or exact timestamps unless
the behavior requires them.

## Package dependency boundary

`ocp-testing` is intended for downstream package and integration tests. Keep
`ocp-core` and `ocp-protocol` as dependency roots to avoid a workspace
cycle. Their low-level behavior belongs in their own focused tests or the root
integration suite.

## Validation commands

Run the smallest useful command while iterating, then the affected graph:

```bash
pnpm --filter <package> test
pnpm test:root
pnpm test
pnpm typecheck
pnpm lint
```

For workspace changes, the final check should include package build order and
tests:

```bash
pnpm exec turbo run build test typecheck lint
```

When a command fails, distinguish a test failure from an unrelated repository
format/configuration failure and report both accurately; do not weaken tests
or skip validation to make the command green.
