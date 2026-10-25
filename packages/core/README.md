# ocp-core

Small provider-neutral primitives shared by OCP runtimes and integrations.

## API

- `EventBus` and `InMemoryEventBus` for asynchronous event subscriptions.
- `createIdentifier`, `createCorrelationId`, and `createActionId` for namespaced application-level identifiers.
- `OpenChannelError` and classified validation, protocol, transport, conflict, and not-found errors.

The core package intentionally does not own provider transport, persistence, policy decisions, or agent orchestration. Its event bus is generic so protocol packages can depend on the shared errors without a dependency cycle.

## Development

```bash
pnpm --filter ocp-core build
pnpm --filter ocp-core typecheck
```
