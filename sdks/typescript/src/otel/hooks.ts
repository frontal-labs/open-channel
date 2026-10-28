import { type EventEnvelope, eventType } from "@openchannelprotocol/protocol";
import type { OpenChannelHooks } from "../types.js";

import type { OpenChannelSpan, OpenChannelTracer, OpenTelemetryOptions } from "./types.js";

type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Runs one instrumentation step. The SDK forwards hook failures to `onError`, which would
 * re-enter these hooks, so telemetry failures are swallowed here instead.
 */
function instrument(step: () => void): void {
  try {
    step();
  } catch {
    // A broken tracer or meter must not change how OCP events are processed.
  }
}

/** Starts and immediately ends a span. Attributes that are `undefined` are not set. */
function emitSpan(
  tracer: OpenChannelTracer,
  name: string,
  attributes: SpanAttributes,
  configure?: (span: OpenChannelSpan) => void,
): void {
  tracer.startActiveSpan(name, (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        span.setAttribute?.(key, value);
      }
    }
    configure?.(span);
    span.end();
  });
}

function eventAttributes(event: EventEnvelope): SpanAttributes {
  return {
    "ocp.event_id": event.eventId,
    "ocp.event_type": eventType(event),
    "ocp.protocol_version": event.protocolVersion,
  };
}

/**
 * Creates SDK hooks that emit OpenTelemetry spans and counters for OCP activity.
 *
 * Spans are zero-duration: each one is started and ended inside its hook, so they mark an event
 * rather than time it. Hooks never throw into the SDK, even when the tracer or a counter fails.
 */
export function otelHooks(options: OpenTelemetryOptions): OpenChannelHooks {
  return {
    onActionCompleted: (result) =>
      instrument(() => {
        options.counters?.actions?.add(1, { status: result.status });
      }),
    onActionStarted: (action) =>
      instrument(() => {
        emitSpan(options.tracer, "ocp.action", {
          "ocp.action": action.type,
          "ocp.action_id": action.actionId,
        });
      }),
    onDelivery: (receipt) =>
      instrument(() => {
        options.counters?.deliveries?.add(1, { provider: receipt.provider });
        emitSpan(options.tracer, "ocp.delivery", {
          "ocp.event_id": receipt.eventId,
          "ocp.external_id": receipt.externalId || undefined,
          "ocp.provider": receipt.provider,
        });
      }),
    onError: (error) =>
      instrument(() => {
        options.counters?.errors?.add(1);
        emitSpan(options.tracer, "ocp.error", {}, (span) => span.recordException?.(error));
      }),
    onEventAccepted: (event) =>
      instrument(() => {
        options.counters?.events?.add(1, { event_type: eventType(event) });
        emitSpan(options.tracer, "ocp.event.accepted", eventAttributes(event));
      }),
    onEventProcessed: (event) =>
      instrument(() => {
        emitSpan(options.tracer, "ocp.event.processed", eventAttributes(event));
      }),
  };
}
