import type { ChannelAdapter } from "@openchannelprotocol/adapter";
import type { PolicyDecision, PolicyEngine } from "@openchannelprotocol/policy";
import type {
  ActionRequest,
  ActorRef,
  ApprovalOutcome,
  EventEnvelope,
} from "@openchannelprotocol/protocol";

/** Append-only event store contract used by the runtime. */
export interface EventStore {
  all: () => Promise<EventEnvelope[]>;
  append: (event: EventEnvelope) => Promise<void>;
  /** Atomically appends an event and returns false when it already exists. */
  appendIfAbsent?: (event: EventEnvelope) => Promise<boolean>;
  claimAction?: (actionId: string, owner: string) => Promise<boolean>;
  close?: () => Promise<void> | void;
  completeAction?: (actionId: string, result: unknown) => Promise<void>;
  failAction?: (actionId: string, error: unknown) => Promise<void>;
  get?: (eventId: string) => Promise<EventEnvelope | undefined>;
  getAction?: (actionId: string) => Promise<ActionExecutionRecord | undefined>;
  has: (eventId: string) => Promise<boolean>;
  list?: (options?: { eventType?: string; limit?: number }) => Promise<EventEnvelope[]>;
  query?: (options?: { eventType?: string; limit?: number }) => Promise<EventEnvelope[]>;
}

/** Durable state used to make registered action execution idempotent. */
export interface ActionExecutionRecord {
  actionId: string;
  error?: unknown;
  owner?: string;
  result?: unknown;
  status: "claimed" | "completed" | "failed";
}

/** Scheduling abstraction that keeps approval expiry testable. */
export interface Clock {
  cancel: (handle: unknown) => void;
  now: () => Date;
  schedule: (delayMs: number, callback: () => void | Promise<void>) => unknown;
}

/** Dependencies and defaults used to construct an OCP runtime. */
export interface RuntimeOptions {
  clock?: Clock;
  defaultApprovalTimeoutMs?: number;
  /** Durable event store. Required: the runtime has no implicit storage. */
  eventStore: EventStore;
  policy: PolicyEngine;
  runtimeActor?: ActorRef;
}

/** Result returned after processing an event. */
export interface RuntimeResult {
  duplicate: boolean;
  emitted: EventEnvelope[];
}

/** A named alias used by high-level app APIs for accepted intake results. */
export type IngestResult = RuntimeResult;

/** Inputs required to submit an action through policy evaluation. */
export interface SubmitActionInput {
  action: ActionRequest;
  actor: ActorRef;
  approver: ActorRef;
  channel?: EventEnvelope["channel"];
  conversation?: EventEnvelope["conversation"];
  deadline?: Date;
  reason: string;
  recipient?: ActorRef;
}

/** Lifecycle states returned by action submission. */
export type SubmitActionStatus = "authorized" | "approval_required" | "blocked";

/** Policy and event results from submitting an action. */
export interface SubmitActionResult {
  approvalId?: string;
  decision: PolicyDecision;
  events: EventEnvelope[];
  status: SubmitActionStatus;
}

/** Input used to resolve a pending approval. */
export interface DecideApprovalInput {
  approvalId: string;
  approver: ActorRef;
  outcome: ApprovalOutcome.GRANTED | ApprovalOutcome.DENIED;
  reason?: string;
}

/** Runtime state tracked while an approval is pending. */
export interface PendingApproval {
  action: ActionRequest;
  agent: ActorRef;
  approvalId: string;
  approver: ActorRef;
  channel?: EventEnvelope["channel"];
  conversation?: EventEnvelope["conversation"];
  status: "pending" | "granted" | "denied" | "expired";
  timer?: unknown;
}

/** Subscriber invoked for each accepted or emitted event. */
export type EventHandler = (event: EventEnvelope) => void | Promise<void>;

/** Configuration for a provider gateway. */
export interface ChannelGatewayOptions {
  adapters?: ChannelAdapter[];
  runtime: { process: (event: EventEnvelope) => Promise<RuntimeResult> };
}
