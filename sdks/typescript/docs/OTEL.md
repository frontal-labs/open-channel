# ocp-sdk/otel

OpenTelemetry instrumentation for OCP apps. Passing the hooks from this package to `openChannel()`
emits a span and, where configured, a counter increment for accepted events, processed events,
action starts and completions, deliveries, and errors. Your existing OpenTelemetry SDK exports the
data; this package only calls the tracer and meter ports you give it.

## Where it sits in the OCP flow

```text
provider input -> OCP message.received (span + counter) -> harness
  -> action started/completed (span + counter) -> OCP message.sent -> delivery (span + counter)
```

## Install

```sh
pnpm add ocp-sdk
```

## Quickstart

The package takes structural ports, so any OpenTelemetry tracer or counter works. The stub below
shows the shape; in production pass the tracer from `@opentelemetry/api`.

```ts
import { otelHooks } from "ocp-sdk/otel";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { postgresStore } from "ocp-sdk/postgres";
import { openChannel } from "ocp-sdk";

const hooks = otelHooks({
  tracer: {
    startActiveSpan: (name, callback) =>
      callback({
        end: () => {},
        setAttribute: () => {},
      }),
  },
  counters: {
    events: { add: () => {} },
    actions: { add: () => {} },
    deliveries: { add: () => {} },
    errors: { add: () => {} },
  },
});

const app = openChannel({
  channels: [],
  hooks,
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: postgresStore({ client: pool }), // pool: your PostgresClient, see POSTGRES.md
});
```

Replace the stub tracer and counters with `trace.getTracer("ocp")` and
`meter.createCounter("ocp.events")` from OpenTelemetry in production. `counters` is optional, and
any counter you leave out is skipped.

## Telemetry contract

| Hook                  | Span name            | Counter (attributes)                  |
| --------------------- | -------------------- | ------------------------------------- |
| `onEventAccepted`     | `ocp.event.accepted` | `events` (`event_type`)               |
| `onEventProcessed`    | `ocp.event.processed`| none                                  |
| `onActionStarted`     | `ocp.action`         | none                                  |
| `onActionCompleted`   | none                 | `actions` (`status`)                  |
| `onDelivery`          | `ocp.delivery`       | `deliveries` (`provider`)             |
| `onError`             | `ocp.error`          | `errors`                              |

Spans carry `ocp.event_id`, `ocp.event_type`, and `ocp.protocol_version` where they apply. Attribute
names are part of the public contract, so dashboards can rely on them.

Spans are zero-duration: each one starts and ends inside its hook, so they mark an event rather than
time it. For latency, instrument the harness code that runs between the hooks.

## Failure behavior

Hooks never throw into the SDK. A broken tracer or counter is swallowed, so telemetry problems never
change how events are processed.

## Environment

None. Exporters, endpoints, and sampling are configured in your OpenTelemetry SDK setup, not here.

## Tests

```sh
pnpm --filter ocp-sdk test
```

The tests use recording fakes for the tracer and counters and need no collector.
