# OCP TypeScript packages

- [`protocol/`](./protocol/) — wire types, validation, and serialization.
- [`core/`](./core/) — shared errors, identifiers, and event primitives.
- [`runtime/`](./runtime/) — event processing, policy approvals, and dispatch.
- [`policy/`](./policy/) — policy interfaces and reference rules.
- [`adapter/`](./adapter/) — provider adapter contracts and in-memory adapter.
- [`testing/`](./testing/) — shared OCP fixtures and test coordination helpers.

Each package has a package-local `turbo.json` extending the root task graph and an explicit `src/index.ts` public entrypoint.