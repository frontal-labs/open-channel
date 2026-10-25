# OCP tests

The root Vitest project contains cross-package conformance tests for the protocol, runtime, adapters, policy engine, CLI, core primitives, TypeScript SDK, and shared `ocp-testing` package. Each TypeScript workspace package also exposes a Turbo-managed `test` task for its focused tests.

Run the suite with:

```bash
pnpm test
```

Native SDK tests live beside their implementations in `sdks/python/tests` and
the Rust SDK's unit-test module. Run all SDK tests with `pnpm sdk:test`.
