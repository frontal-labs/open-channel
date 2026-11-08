# ocp-core

Small provider-neutral primitives shared by OCP runtimes and integrations.

## API

- `EventBus` and `InMemoryEventBus` for asynchronous event subscriptions.
- `createIdentifier`, `createCorrelationId`, and `createActionId` for namespaced application-level identifiers.
- `OpenChannelError` and classified validation, protocol, transport, conflict, authorization, action, and not-found errors. Each one is a `FrontalError` from `@frontal-labs/error` with `scope: "ocp"`, its OCP `code`, an HTTP `statusCode`, the preserved `cause` and `ocp.*` telemetry attributes.
- `toChannelText(err)`: text that is safe to show a person in a channel. It returns the error's approved `public.message`, or a fixed text per code. Developer messages, details, identifiers and policy text never appear in it.
- `toToolFailure(err)`: the tool result for an agent. It contains only `success`, `error.scope`, `error.code` and public text (`message`, `hint`, `fix`, `link`).
- `toFailureRecord(err)`: a JSON-safe record for logs and the event store. It keeps the developer message, so it must never reach a channel or an agent.
- `hasCode`, `isFrontalError`, and `getRootCause` from `@frontal-labs/error`.

`metadata` holds only the `details` values that survive JSON; a value that does not (a function, a cycle, a `BigInt`) stays in `details` alone. Errors do not cross process boundaries as instances, because `isFrontalError` does not survive JSON, structured clone or `postMessage`. Persist `toFailureRecord(err)` and read it back as a plain object.

The core package intentionally does not own provider transport, persistence, policy decisions, or agent orchestration. Its event bus is generic so protocol packages can depend on the shared errors without a dependency cycle. `@frontal-labs/error` is pinned exactly (`0.7.0`) and has no transitive dependencies.

## Development

```bash
pnpm --filter ocp-core build
pnpm --filter ocp-core typecheck
```
