import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AuthorizationError, ConflictError, NotFoundError } from "ocp-core";
import type { PolicyContext } from "ocp-policy";
import {
  ActionRequestSchema,
  type ActorRef,
  ApprovalDecidedSchema,
  ApprovalExpiredSchema,
  ApprovalOutcome,
  ApprovalRequestedSchema,
  EscalationTriggeredSchema,
  type EventEnvelope,
  eventType,
  newEvent,
  PolicyEvaluatedSchema,
} from "ocp-protocol";

import { SYSTEM_ACTOR } from "./actors.js";
import { SystemClock } from "./clock.js";
import type {
  ActionExecutionRecord,
  Clock,
  DecideApprovalInput,
  EventHandler,
  EventStore,
  PendingApproval,
  RuntimeOptions,
  RuntimeResult,
  SubmitActionInput,
  SubmitActionResult,
} from "./types.js";

/** Approval events the runtime produces itself; external callers may not submit them. */
const APPROVAL_LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "approval.expired",
]);

/** Events only the runtime may write. Inbound copies are rejected even though they look well-formed. */
const RUNTIME_ONLY_EVENTS: ReadonlySet<string> = new Set([
  ...APPROVAL_LIFECYCLE_EVENTS,
  "action.executed",
  "action.failed",
  "escalation.triggered",
]);

/** Processes OCP events and manages policy-controlled approvals. */
export class OpenChannelRuntime {
  readonly eventStore: EventStore;
  readonly clock: Clock;
  private readonly policy: RuntimeOptions["policy"];
  private readonly defaultApprovalTimeoutMs: number;
  /** The identity the runtime stamps on the events it produces. */
  readonly runtimeActor: ActorRef;
  private readonly pendingApprovals: Partial<Record<string, PendingApproval>> = Object.create(null);
  private readonly handlers = new Set<EventHandler>();
  private readonly actionRecords: Partial<Record<string, ActionExecutionRecord>> =
    Object.create(null);

  constructor(options: RuntimeOptions) {
    this.policy = options.policy;
    this.eventStore = options.eventStore;
    this.clock = options.clock ?? new SystemClock();
    this.defaultApprovalTimeoutMs = options.defaultApprovalTimeoutMs ?? 60_000;
    this.runtimeActor = options.runtimeActor ?? SYSTEM_ACTOR;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Claims an action ID exactly once across this runtime/store. */
  claimAction(actionId: string, owner: string): Promise<boolean> {
    if (this.eventStore.claimAction) {
      return this.eventStore.claimAction(actionId, owner);
    }
    if (actionId in this.actionRecords) {
      return Promise.resolve(false);
    }
    this.actionRecords[actionId] = {
      actionId,
      owner,
      status: "claimed",
    };
    return Promise.resolve(true);
  }

  async completeAction(actionId: string, result: unknown): Promise<void> {
    if (this.eventStore.completeAction) {
      await this.eventStore.completeAction(actionId, result);
    }
    const current = this.actionRecords[actionId];
    this.actionRecords[actionId] = {
      actionId,
      owner: current?.owner,
      result,
      status: "completed",
    };
  }

  async failAction(actionId: string, error: unknown): Promise<void> {
    if (this.eventStore.failAction) {
      await this.eventStore.failAction(actionId, error);
    }
    const current = this.actionRecords[actionId];
    this.actionRecords[actionId] = {
      actionId,
      error,
      owner: current?.owner,
      status: "failed",
    };
  }

  getAction(actionId: string): Promise<ActionExecutionRecord | undefined> {
    if (this.eventStore.getAction) {
      return this.eventStore.getAction(actionId);
    }
    return Promise.resolve(this.actionRecords[actionId]);
  }

  getEvent(eventId: string): Promise<EventEnvelope | undefined> {
    if (this.eventStore.get) {
      return this.eventStore.get(eventId);
    }
    return this.eventStore
      .all()
      .then((events) => events.find((event) => event.eventId === eventId));
  }

  queryEvents(options: { eventType?: string; limit?: number } = {}): Promise<EventEnvelope[]> {
    if (this.eventStore.query) {
      return this.eventStore.query(options);
    }
    if (this.eventStore.list) {
      return this.eventStore.list(options);
    }
    return this.eventStore.all().then((events) => {
      const filtered = options.eventType
        ? events.filter((event) => eventType(event) === options.eventType)
        : events;
      return options.limit === undefined ? filtered : filtered.slice(-options.limit);
    });
  }

  async close(): Promise<void> {
    await this.eventStore.close?.();
  }

  /**
   * Accepts events from callers and channel ingress. Approval lifecycle events are produced only by
   * the runtime (`submitAction`, `decideApproval`, and the expiry timer), so they are rejected here
   * rather than trusted from the envelope.
   */
  async process(event: EventEnvelope): Promise<RuntimeResult> {
    const name = eventType(event);
    if (RUNTIME_ONLY_EVENTS.has(name)) {
      throw new AuthorizationError(
        `OCP ${name} events are produced by the runtime and cannot be submitted from outside`,
        { stage: "approval" },
      );
    }
    if (event.source?.id === this.runtimeActor.id) {
      throw new AuthorizationError("OCP events cannot claim the runtime actor as their source", {
        stage: "approval",
      });
    }
    return await this.handleEvent(event);
  }

  /** Records an event the SDK itself produced, such as an action outcome. Not for inbound input. */
  async processInternal(event: EventEnvelope): Promise<RuntimeResult> {
    return await this.handleEvent(event);
  }

  private async handleEvent(event: EventEnvelope): Promise<RuntimeResult> {
    let accepted: boolean;
    if (this.eventStore.appendIfAbsent) {
      accepted = await this.eventStore.appendIfAbsent(event);
    } else if (await this.eventStore.has(event.eventId)) {
      accepted = false;
    } else {
      await this.eventStore.append(event);
      accepted = true;
    }
    if (!accepted) {
      return { duplicate: true, emitted: [] };
    }

    await this.notify(event);
    const emitted: EventEnvelope[] = [];

    if (event.payload.case === "approvalRequested") {
      this.trackApproval(event);
    }

    if (event.payload.case === "approvalDecided") {
      this.resolveApproval(event.payload.value.approvalId, event.payload.value.outcome);
    }

    if (event.payload.case === "approvalExpired") {
      const pending = this.pendingApprovals[event.payload.value.approvalId];
      if (pending && pending.status === "pending") {
        pending.status = "expired";
        const escalation = newEvent({
          actor: this.runtimeActor,
          causationId: event.eventId,
          channel: pending.channel,
          conversation: pending.conversation,
          correlationId: event.correlationId || event.eventId,
          occurredAt: timestampFromDate(this.clock.now()),
          payload: {
            case: "escalationTriggered",
            value: create(EscalationTriggeredSchema, {
              escalationId: `${event.payload.value.approvalId}:escalation`,
              reason: "Approval deadline expired",
              relatedApprovalId: event.payload.value.approvalId,
              source: pending.agent,
              target: pending.approver,
            }),
          },
          recipient: pending.approver,
          source: this.runtimeActor,
        });
        await this.record(escalation);
        emitted.push(escalation);
      }
    }

    return { duplicate: false, emitted };
  }

  async submitAction(input: SubmitActionInput): Promise<SubmitActionResult> {
    const context: PolicyContext = {
      actionType: input.action.type,
      actor: input.actor,
      recipient: input.recipient,
      target: input.action.target,
    };
    const decision = this.policy.evaluate(context);
    const policyEvent = newEvent({
      actor: input.actor,
      channel: input.channel,
      conversation: input.conversation,
      occurredAt: timestampFromDate(this.clock.now()),
      payload: {
        case: "policyEvaluated",
        value: create(PolicyEvaluatedSchema, {
          actionType: input.action.type,
          allowed: decision.allowed,
          approvalRequired: decision.approvalRequired,
          policyId: decision.policyId,
          reason: decision.reason,
          recipient: input.recipient,
        }),
      },
      recipient: input.recipient,
      source: this.runtimeActor,
    });
    await this.handleEvent(policyEvent);
    const events = [policyEvent];

    if (!decision.allowed) {
      return { decision, events, status: "blocked" };
    }

    if (!decision.approvalRequired) {
      return { decision, events, status: "authorized" };
    }

    const approvalId = `${input.action.actionId || input.action.type}:${this.clock.now().getTime()}`;
    const deadline =
      input.deadline ?? new Date(this.clock.now().getTime() + this.defaultApprovalTimeoutMs);
    const approvalEvent = newEvent({
      actor: input.actor,
      causationId: policyEvent.eventId,
      channel: input.channel,
      conversation: input.conversation,
      correlationId: policyEvent.eventId,
      occurredAt: timestampFromDate(this.clock.now()),
      payload: {
        case: "approvalRequested",
        value: create(ApprovalRequestedSchema, {
          agent: input.actor,
          approvalId,
          approver: input.approver,
          deadline: timestampFromDate(deadline),
          reason: input.reason,
          requestedAction: input.action,
        }),
      },
      recipient: input.approver,
      source: this.runtimeActor,
    });
    await this.handleEvent(approvalEvent);
    events.push(approvalEvent);

    return { approvalId, decision, events, status: "approval_required" };
  }

  async decideApproval(input: DecideApprovalInput): Promise<RuntimeResult> {
    const pending = this.pendingApprovals[input.approvalId];
    if (!pending) {
      throw new NotFoundError("OCP approval", input.approvalId);
    }
    if (pending.status !== "pending") {
      throw new ConflictError("OCP approval", input.approvalId, {
        details: { status: pending.status },
      });
    }
    if (pending.approver.id !== input.approver.id) {
      throw new AuthorizationError(
        `OCP approval ${input.approvalId} can only be decided by ${pending.approver.id}`,
        { approvalId: input.approvalId, stage: "approval" },
      );
    }

    const event = newEvent({
      actor: input.approver,
      channel: pending.channel,
      conversation: pending.conversation,
      correlationId: input.approvalId,
      occurredAt: timestampFromDate(this.clock.now()),
      payload: {
        case: "approvalDecided",
        value: create(ApprovalDecidedSchema, {
          approvalId: input.approvalId,
          approver: input.approver,
          outcome: input.outcome,
          reason: input.reason ?? "",
        }),
      },
      recipient: pending.agent,
      source: this.runtimeActor,
    });
    return await this.handleEvent(event);
  }

  /** True when the runtime itself produced the event, judged by its source actor. */
  ownsEvent(event: EventEnvelope): boolean {
    return event.source?.id === this.runtimeActor.id;
  }

  /**
   * Rebuilds pending approvals from the event store after a restart and reschedules their expiry.
   * Unresolved `approval.requested` events are tracked again; a deadline that passed while the
   * process was down expires immediately. Returns the requests that were restored.
   */
  async restorePendingApprovals(): Promise<EventEnvelope[]> {
    const requests = await this.ownedApprovalRequests();
    const resolved = new Set<string>();
    for (const type of ["approval.granted", "approval.denied", "approval.expired"]) {
      for (const event of await this.queryEvents({ eventType: type })) {
        const approvalId = approvalIdOf(event);
        const request = approvalId ? requests.get(approvalId) : undefined;
        if (approvalId && request && this.isAuthorizedResolution(event, request)) {
          resolved.add(approvalId);
        }
      }
    }
    const restored: EventEnvelope[] = [];
    for (const [approvalId, event] of requests) {
      if (resolved.has(approvalId) || this.pendingApprovals[approvalId]) {
        continue;
      }
      this.trackApproval(event);
      restored.push(event);
    }
    return restored;
  }

  /** Approval requests the runtime itself produced, keyed by approval ID. Inbound copies are ignored. */
  async ownedApprovalRequests(): Promise<Map<string, EventEnvelope>> {
    const requests = new Map<string, EventEnvelope>();
    for (const event of await this.queryEvents({ eventType: "approval.requested" })) {
      if (event.payload.case === "approvalRequested" && this.ownsEvent(event)) {
        requests.set(event.payload.value.approvalId, event);
      }
    }
    return requests;
  }

  /**
   * True when a granted, denied, or expired event legitimately resolves `request`. Expiry is the
   * runtime's own. A decision must come from the runtime and name the designated approver.
   */
  isAuthorizedResolution(event: EventEnvelope, request: EventEnvelope): boolean {
    if (request.payload.case !== "approvalRequested") {
      return false;
    }
    if (event.payload.case === "approvalExpired") {
      return this.ownsEvent(event);
    }
    if (event.payload.case !== "approvalDecided") {
      return false;
    }
    const designated = request.payload.value.approver?.id;
    if (!designated || event.payload.value.approver?.id !== designated) {
      return false;
    }
    // Runtime-written decisions are the norm. Decisions stored before the source change carry the
    // approver as their source, so the designated approver's own legacy decision is still honoured.
    return this.ownsEvent(event) || event.source?.id === designated;
  }

  private trackApproval(event: EventEnvelope): void {
    if (event.payload.case !== "approvalRequested") {
      return;
    }
    const approval = event.payload.value;
    const deadlineMs = approval.deadline
      ? Number(approval.deadline.seconds) * 1000 + approval.deadline.nanos / 1_000_000
      : undefined;
    const delayMs =
      deadlineMs === undefined
        ? this.defaultApprovalTimeoutMs
        : Math.max(0, deadlineMs - this.clock.now().getTime());
    const pending: PendingApproval = {
      action: approval.requestedAction ?? create(ActionRequestSchema),
      agent: approval.agent ?? this.runtimeActor,
      approvalId: approval.approvalId,
      approver: approval.approver ?? this.runtimeActor,
      channel: event.channel,
      conversation: event.conversation,
      status: "pending",
    };
    pending.timer = this.clock.schedule(delayMs, async () => {
      if (pending.status !== "pending") {
        return;
      }
      const expired = newEvent({
        actor: this.runtimeActor,
        causationId: event.eventId,
        channel: pending.channel,
        conversation: pending.conversation,
        correlationId: event.correlationId || event.eventId,
        occurredAt: timestampFromDate(this.clock.now()),
        payload: {
          case: "approvalExpired",
          value: create(ApprovalExpiredSchema, {
            approvalId: pending.approvalId,
            reason: "Approval deadline expired",
          }),
        },
        recipient: pending.approver,
        source: this.runtimeActor,
      });
      await this.handleEvent(expired);
    });
    this.pendingApprovals[approval.approvalId] = pending;
  }

  private resolveApproval(approvalId: string, outcome: ApprovalOutcome): void {
    const pending = this.pendingApprovals[approvalId];
    if (pending?.status !== "pending") {
      return;
    }
    if (outcome === ApprovalOutcome.GRANTED) {
      pending.status = "granted";
    }
    if (outcome === ApprovalOutcome.DENIED) {
      pending.status = "denied";
    }
    if (pending.status !== "pending" && pending.timer !== undefined) {
      this.clock.cancel(pending.timer);
    }
  }

  private async record(event: EventEnvelope): Promise<void> {
    await this.eventStore.append(event);
    await this.notify(event);
  }

  private async notify(event: EventEnvelope): Promise<void> {
    for (const handler of this.handlers) {
      // biome-ignore lint/performance/noAwaitInLoops: Event handlers are ordered subscribers.
      await handler(event);
    }
  }
}

/** The approval ID carried by a decision or expiry event, if it has one. */
function approvalIdOf(event: EventEnvelope): string | undefined {
  if (event.payload.case === "approvalDecided" || event.payload.case === "approvalExpired") {
    return event.payload.value.approvalId;
  }
  return undefined;
}
