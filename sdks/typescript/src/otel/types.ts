import type { EventEnvelope } from "ocp-protocol";
import type { OpenChannelHooks } from "../types.js";

/**
 * Structural span port. An OpenTelemetry `Span` satisfies it. Only `end` is required; the other
 * methods are optional so that minimal span implementations still work.
 */
export interface OpenChannelSpan {
  end: () => void;
  recordException?: (error: unknown) => void;
  setAttribute?: (key: string, value: string | number | boolean) => void;
}

/** Structural tracer port. An OpenTelemetry `Tracer` satisfies it. */
export interface OpenChannelTracer {
  /** Runs `callback` with a new span and ends it when the hook finishes. */
  startActiveSpan: <T>(name: string, callback: (span: OpenChannelSpan) => T) => T;
}

/** Structural counter port. An OpenTelemetry `Counter` satisfies it. */
export interface OpenChannelCounter {
  add: (value: number, attributes?: Record<string, string | number | boolean>) => void;
}

/** Tracer and optional counters used to instrument OCP activity. */
export interface OpenTelemetryOptions {
  /**
   * Counters incremented by the hooks; omitted counters are skipped. `actions` is tagged with
   * `status`, `deliveries` with `provider`, and `events` with `event_type`. `errors` has no
   * attributes. The attribute keys are part of the public contract.
   */
  counters?: Partial<Record<"actions" | "deliveries" | "events" | "errors", OpenChannelCounter>>;
  /** Tracer that receives the spans. Required; every hook emits at least one span. */
  tracer: OpenChannelTracer;
}

/** OCP hooks that record spans and metrics through OpenTelemetry. */
export type OpenTelemetryHooks = OpenChannelHooks;

/** Callback invoked for each OCP event envelope. */
export type EventObserver = (event: EventEnvelope) => void | Promise<void>;
