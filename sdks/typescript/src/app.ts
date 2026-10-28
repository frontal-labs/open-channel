import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ActionError,
  ConflictError,
  createActionId,
  OpenChannelError,
  ValidationError,
} from "@openchannelprotocol/core";
import {
  ActionExecutedSchema,
  ActionFailedSchema,
  type ActionRequest,
  ActionRequestSchema,
  type ActorRef,
  ApprovalOutcome,
  type EventEnvelope,
  type EventType,
  eventType,
  newEvent,
} from "@openchannelprotocol/protocol";
import { ChannelGateway, type EventStore, OpenChannelRuntime, SYSTEM_ACTOR } from "@openchannelprotocol/runtime";
import { AgentHost } from "./agent-host.js";
import type {
  ActionDefinition,
  ActionExecutionContext,
  ActionRequestOptions,
  ActionResult,
  AgentCard,
  AgentDefinition,
  ChannelDefinition,
  OpenChannel,
  OpenChannelHooks,
  OpenChannelOptions,
} from "./types.js";

interface PendingAction {
  action: ActionRequest;
  actor: ActorRef;
  definition: ActionDefinition<unknown, unknown>;
  event: EventEnvelope;
  input: unknown;
  options: ActionRequestOptions;
}

type State = "created" | "running" | "stopping" | "stopped";

/** Builds an OCP application from agents, actions, channels, a policy, and an event store. */
export function openChannel(options: OpenChannelOptions): OpenChannel {
  return new OpenChannelApp(options);
}

class OpenChannelApp implements OpenChannel {
  readonly gateway: ChannelGateway;
  readonly runtime: OpenChannelRuntime;
  readonly store: EventStore;
  private readonly actions: Partial<Record<string, ActionDefinition<unknown, unknown>>> =
    Object.create(null);
  private readonly approver: ActorRef;
  private readonly hooks: OpenChannelHooks;
  private readonly pendingActions: Partial<Record<string, PendingAction>> = Object.create(null);
  private readonly actionResults: Partial<Record<string, ActionResult<unknown>>> =
    Object.create(null);
  private readonly actionRuns: Partial<Record<string, Promise<ActionResult<unknown>>>> =
    Object.create(null);
  private readonly host: AgentHost;
  private state: State = "created";
  private sourceAbort?: AbortController;
  private runtimeSubscription?: () => void;
  private readonly active = new Set<Promise<unknown>>();

  constructor(options: OpenChannelOptions) {
    this.hooks = options.hooks ?? {};
    this.store = options.store;
    this.approver = options.approver ?? SYSTEM_ACTOR;
    this.runtime = new OpenChannelRuntime({
      clock: options.clock,
      defaultApprovalTimeoutMs: options.approvalTimeoutMs,
      eventStore: options.store,
      policy: options.policy,
      runtimeActor: options.runtimeActor,
    });
    this.gateway = new ChannelGateway(this.runtime);
    for (const channel of options.channels ?? []) {
      this.addChannel(channel);
    }
    for (const action of options.actions ?? []) {
      this.addAction(action);
    }
    this.host = new AgentHost({
      actionRequester: (agent, event, type, input, actionOptions) =>
        this.requestAction(agent, event, type, input, actionOptions),
      agents: options.agents,
      gateway: this.gateway,
      logger: options.logger,
      maxConcurrentConversations: options.concurrency,
      onDelivery: (receipt) => this.runHook(this.hooks.onDelivery, receipt),
      onError: (error) => this.runHook(this.hooks.onError, error),
      runtime: this.runtime,
    });
    this.runtimeSubscription = this.runtime.subscribe((event) => this.handleRuntimeEvent(event));
  }

  addAgent(agent: AgentDefinition): void {
    this.host.register(agent);
  }

  agentCards(): AgentCard[] {
    return this.host.agentCards();
  }

  addAction<TInput, TResult>(action: ActionDefinition<TInput, TResult>): void {
    if (action.type in this.actions) {
      throw new ConflictError("OCP action", action.type);
    }
    this.actions[action.type] = action as ActionDefinition<unknown, unknown>;
  }

  addChannel(channel: ChannelDefinition): void {
    if (channel.sink) {
      this.gateway.register(channel.sink);
    }
    if (channel.source) {
      this.gateway.registerSource(channel.source);
    }
  }

  on(type: EventType, handler: (event: EventEnvelope) => void | Promise<void>): () => void {
    return this.runtime.subscribe(async (event) => {
      if (eventType(event) !== type) {
        return;
      }
      try {
        await handler(event);
      } catch (error) {
        await this.reportError(error, event.eventId);
      }
    });
  }

  async start(): Promise<void> {
    if (this.state === "running") {
      return;
    }
    if (this.state === "stopping" || this.state === "stopped") {
      throw new OpenChannelError("OCP_TRANSPORT", `Cannot start OCP app while it is ${this.state}`);
    }
    this.sourceAbort = new AbortController();
    this.host.attach();
    await this.recoverApprovals();
    await this.gateway.start(
      async (event) => {
        try {
          await this.ingest(event);
        } catch (error) {
          await this.reportError(error, event.eventId);
        }
      },
      this.sourceAbort.signal,
      (error) => this.reportError(error),
    );
    this.state = "running";
  }

  async stop(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.state === "stopped") {
      return;
    }
    this.state = "stopping";
    const timeoutMs = Math.max(0, options.timeoutMs ?? 30_000);
    const startedAt = Date.now();
    this.sourceAbort?.abort();
    try {
      await this.withTimeout(this.gateway.stop(), timeoutMs, "source shutdown");
      // The host stays subscribed while draining so in-flight conversations can still reply.
      await this.drain(this.remainingTimeout(startedAt, timeoutMs));
      await this.withTimeout(
        this.gateway.close(),
        this.remainingTimeout(startedAt, timeoutMs),
        "channel shutdown",
      );
      await this.withTimeout(
        this.runtime.close(),
        this.remainingTimeout(startedAt, timeoutMs),
        "store shutdown",
      );
    } finally {
      this.host.detach();
      this.runtimeSubscription?.();
      this.runtimeSubscription = undefined;
      this.state = "stopped";
    }
  }

  ingest(event: EventEnvelope) {
    this.assertAccepting();
    return this.track(this.gateway.ingest(event));
  }

  receive(provider: string, input: unknown, metadata?: Parameters<ChannelGateway["receive"]>[2]) {
    this.assertAccepting();
    return this.track(this.gateway.receive(provider, input, metadata));
  }

  approve(approvalId: string, approver: ActorRef, reason?: string) {
    return this.runtime.decideApproval({
      approvalId,
      approver,
      outcome: ApprovalOutcome.GRANTED,
      reason,
    });
  }

  deny(approvalId: string, approver: ActorRef, reason?: string) {
    return this.runtime.decideApproval({
      approvalId,
      approver,
      outcome: ApprovalOutcome.DENIED,
      reason,
    });
  }

  /**
   * Recovers approval-driven work after a restart. Unresolved approvals are tracked again, and a
   * granted approval whose action never reached a terminal event runs now. Both rebuild the action
   * from the stored request, so nothing depends on in-process state.
   */
  private async recoverApprovals(): Promise<void> {
    for (const requested of await this.runtime.restorePendingApprovals()) {
      await this.rebuildPendingAction(requested);
    }
    const requests = await this.runtime.ownedApprovalRequests();
    const finished = await this.finishedActionIds();
    for (const decided of await this.runtime.queryEvents({ eventType: "approval.granted" })) {
      if (decided.payload.case !== "approvalDecided") {
        continue;
      }
      const requested = requests.get(decided.payload.value.approvalId);
      const actionId =
        requested?.payload.case === "approvalRequested"
          ? requested.payload.value.requestedAction?.actionId
          : undefined;
      if (!(requested && actionId && this.runtime.isAuthorizedResolution(decided, requested))) {
        continue;
      }
      if (finished.has(actionId)) {
        continue;
      }
      // Fail closed: a durable store that reports the action as finished also blocks a re-run.
      const record = await this.runtime.getAction(actionId);
      if (record?.status === "completed" || record?.status === "failed") {
        continue;
      }
      const pending = await this.rebuildPendingAction(requested);
      if (pending) {
        delete this.pendingActions[decided.payload.value.approvalId];
        await this.executeAction(pending);
      }
    }
  }

  /** Action IDs that already have a runtime-recorded outcome. These are never re-run on restart. */
  private async finishedActionIds(): Promise<Set<string>> {
    const [executed, failed] = await Promise.all([
      this.runtime.queryEvents({ eventType: "action.executed" }),
      this.runtime.queryEvents({ eventType: "action.failed" }),
    ]);
    const finished = new Set<string>();
    for (const event of [...executed, ...failed]) {
      const { payload } = event;
      const action =
        payload.case === "actionExecuted" || payload.case === "actionFailed"
          ? payload.value.action
          : undefined;
      if (action?.actionId && this.runtime.ownsEvent(event)) {
        finished.add(action.actionId);
      }
    }
    return finished;
  }

  /** Rebuilds the in-process pending action for a stored approval request. Returns undefined if it cannot. */
  private async rebuildPendingAction(requested: EventEnvelope): Promise<PendingAction | undefined> {
    if (requested.payload.case !== "approvalRequested") {
      return undefined;
    }
    const request = requested.payload.value;
    const action = request.requestedAction;
    const definition = action ? this.actions[action.type] : undefined;
    if (!(action && definition)) {
      await this.reportError(
        new ValidationError(
          `No OCP action is registered for the approved request ${request.approvalId}`,
        ),
        requested.eventId,
      );
      return undefined;
    }
    let input: unknown;
    try {
      input = definition.validate(JSON.parse(action.parameters.input));
    } catch (error) {
      await this.reportError(error, requested.eventId);
      return undefined;
    }
    const pending: PendingAction = {
      action,
      actor: request.agent ?? SYSTEM_ACTOR,
      definition,
      event: requested,
      input,
      options: {
        channel: requested.channel,
        conversation: requested.conversation,
        recipient: requested.recipient,
      },
    };
    this.pendingActions[request.approvalId] = pending;
    return pending;
  }

  private async requestAction<TInput, TResult>(
    actor: ActorRef,
    inbound: EventEnvelope,
    type: string,
    input: TInput,
    options: ActionRequestOptions = {},
  ): Promise<ActionResult<TResult>> {
    const definition = this.actions[type];
    if (!definition) {
      throw new ValidationError(`No OCP action is registered for type: ${type}`);
    }
    const actionId = options.actionId ?? createActionId();
    const previous = this.actionResults[actionId];
    if (previous) {
      return previous as ActionResult<TResult>;
    }
    const running = this.actionRuns[actionId];
    if (running) {
      return (await running) as ActionResult<TResult>;
    }
    const stored = await this.runtime.getAction(actionId);
    if (stored?.status === "completed") {
      const completed: ActionResult<unknown> = {
        actionId,
        result: stored.result,
        status: "executed",
      };
      this.actionResults[actionId] = completed;
      return completed as ActionResult<TResult>;
    }
    if (stored?.status === "failed") {
      const failed: ActionResult<unknown> = {
        actionId,
        error: this.toActionError(stored.error, actionId),
        status: "failed",
      };
      this.actionResults[actionId] = failed;
      return failed as ActionResult<TResult>;
    }
    let validated: unknown;
    try {
      validated = definition.validate(input);
    } catch (error) {
      const failed: ActionResult<unknown> = {
        actionId,
        error: this.toActionError(error, actionId),
        status: "failed",
      };
      this.actionResults[actionId] = failed;
      return failed as ActionResult<TResult>;
    }
    const action = create(ActionRequestSchema, {
      actionId,
      parameters: { input: this.serializeInput(validated) },
      target: options.target ?? `action:${type}`,
      type,
    });
    if (!(await this.runtime.claimAction(actionId, "@openchannelprotocol/sdk"))) {
      const duplicate: ActionResult<unknown> = {
        actionId,
        error: new ActionError(`OCP action ${actionId} has already been claimed`, {
          actionId,
        }),
        status: "failed",
      };
      this.actionResults[actionId] = duplicate;
      return duplicate as ActionResult<TResult>;
    }
    const actionOptions: ActionRequestOptions & {
      approver: NonNullable<ActionRequestOptions["approver"]>;
      reason: string;
    } = {
      ...options,
      approver: options.approver ?? this.approver,
      channel: options.channel ?? inbound.channel,
      conversation: options.conversation ?? inbound.conversation,
      reason: options.reason ?? `Requested by ${actor.id}`,
    };
    let submission: Awaited<ReturnType<OpenChannelRuntime["submitAction"]>>;
    try {
      submission = await this.runtime.submitAction({
        action,
        actor,
        approver: actionOptions.approver,
        channel: actionOptions.channel,
        conversation: actionOptions.conversation,
        deadline: actionOptions.deadline,
        reason: actionOptions.reason,
        recipient: actionOptions.recipient,
      });
    } catch (error) {
      const actionError = this.toActionError(error, actionId);
      await this.runtime.failAction(actionId, actionError);
      const failed: ActionResult<unknown> = { actionId, error: actionError, status: "failed" };
      this.actionResults[actionId] = failed;
      await this.runHook(this.hooks.onActionCompleted, failed);
      return failed as ActionResult<TResult>;
    }
    if (submission.status === "blocked") {
      const blocked: ActionResult<unknown> = {
        actionId,
        reason: submission.decision.reason,
        status: "blocked",
      };
      this.actionResults[actionId] = blocked;
      return blocked as ActionResult<TResult>;
    }
    const pending: PendingAction = {
      action,
      actor,
      definition,
      event: inbound,
      input: validated,
      options: actionOptions,
    };
    if (submission.status === "approval_required" && submission.approvalId) {
      this.pendingActions[submission.approvalId] = pending;
      const approval: ActionResult<unknown> = {
        actionId,
        approvalId: submission.approvalId,
        status: "approval_required",
      };
      this.actionResults[actionId] = approval;
      return approval as ActionResult<TResult>;
    }
    const run = this.executeAction(pending);
    this.actionRuns[actionId] = run;
    try {
      return (await run) as ActionResult<TResult>;
    } finally {
      delete this.actionRuns[actionId];
    }
  }

  private async executeAction(pending: PendingAction): Promise<ActionResult<unknown>> {
    await this.runHook(this.hooks.onActionStarted, pending.action);
    const context: ActionExecutionContext = {
      actor: pending.actor,
      event: pending.event,
      request: (type, input, options) =>
        this.requestAction(pending.actor, pending.event, type, input, options),
      runtime: this.runtime,
    };
    try {
      const result = await pending.definition.execute(pending.input, context);
      const event = newEvent({
        actor: pending.actor,
        causationId: pending.event.eventId,
        channel: pending.options.channel,
        conversation: pending.options.conversation,
        correlationId: pending.event.correlationId || pending.action.actionId,
        occurredAt: timestampFromDate(this.runtime.clock.now()),
        payload: {
          case: "actionExecuted",
          value: create(ActionExecutedSchema, {
            action: pending.action,
            result: this.serializeResult(result),
          }),
        },
        recipient: pending.options.recipient,
        source: this.runtime.runtimeActor,
      });
      await this.runtime.processInternal(event);
      const completed: ActionResult<unknown> = {
        actionId: pending.action.actionId,
        result,
        status: "executed",
      };
      await this.runtime.completeAction(pending.action.actionId, result);
      this.actionResults[pending.action.actionId] = completed;
      await this.runHook(this.hooks.onActionCompleted, completed);
      return completed;
    } catch (error) {
      const actionError = this.toActionError(error, pending.action.actionId);
      const failedEvent = newEvent({
        actor: pending.actor,
        causationId: pending.event.eventId,
        channel: pending.options.channel,
        conversation: pending.options.conversation,
        correlationId: pending.event.correlationId || pending.action.actionId,
        occurredAt: timestampFromDate(this.runtime.clock.now()),
        payload: {
          case: "actionFailed",
          value: create(ActionFailedSchema, {
            action: pending.action,
            errorCode: actionError.code,
            errorMessage: actionError.message,
            retryable: actionError.retryable,
          }),
        },
        recipient: pending.options.recipient,
        source: this.runtime.runtimeActor,
      });
      await this.runtime.processInternal(failedEvent);
      const failed: ActionResult<unknown> = {
        actionId: pending.action.actionId,
        error: actionError,
        status: "failed",
      };
      await this.runtime.failAction(pending.action.actionId, actionError);
      this.actionResults[pending.action.actionId] = failed;
      await this.runHook(this.hooks.onActionCompleted, failed);
      return failed;
    }
  }

  private async handleRuntimeEvent(event: EventEnvelope): Promise<void> {
    await this.runHook(this.hooks.onEventAccepted, event);
    const decided = event.payload.case === "approvalDecided" ? event.payload.value : undefined;
    const expired = event.payload.case === "approvalExpired" ? event.payload.value : undefined;

    if (decided?.outcome === ApprovalOutcome.GRANTED) {
      const pending = this.pendingActions[decided.approvalId];
      if (pending) {
        delete this.pendingActions[decided.approvalId];
        const run = this.executeAction(pending);
        this.actionRuns[pending.action.actionId] = run;
        try {
          await run;
        } finally {
          delete this.actionRuns[pending.action.actionId];
        }
      }
    } else if (decided?.outcome === ApprovalOutcome.DENIED || expired) {
      const approvalId = decided?.approvalId ?? expired?.approvalId ?? "";
      const pending = this.pendingActions[approvalId];
      if (pending) {
        const reason = expired ? "Approval expired" : "Approval denied";
        const blocked: ActionResult<unknown> = {
          actionId: pending.action.actionId,
          reason,
          status: "blocked",
        };
        this.actionResults[pending.action.actionId] = blocked;
        await this.runtime.failAction(
          pending.action.actionId,
          new ActionError(reason, {
            actionId: pending.action.actionId,
            approvalId,
          }),
        );
        await this.runHook(this.hooks.onActionCompleted, blocked);
      }
      delete this.pendingActions[approvalId];
    }
    await this.runHook(this.hooks.onEventProcessed, event);
  }

  private async runHook<TArgs extends unknown[]>(
    hook: ((...args: TArgs) => void | Promise<void>) | undefined,
    ...args: TArgs
  ): Promise<void> {
    if (!hook) {
      return;
    }
    try {
      await hook(...args);
    } catch (error) {
      await this.hooks.onError?.(this.toOpenChannelError(error));
    }
  }

  private async reportError(error: unknown, eventId?: string): Promise<void> {
    await this.runHook(this.hooks.onError, this.toOpenChannelError(error, eventId));
  }

  private remainingTimeout(startedAt: number, timeoutMs: number): number {
    return Math.max(0, timeoutMs - (Date.now() - startedAt));
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new OpenChannelError("OCP_TRANSPORT", `OCP ${operation} timed out`, {
                  retryable: true,
                  stage: "shutdown",
                }),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async drain(timeoutMs: number): Promise<void> {
    const drain = async (): Promise<void> => {
      if (this.active.size === 0) {
        return;
      }
      await Promise.allSettled(this.active);
      await this.host.waitForIdle();
      await drain();
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        drain(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new OpenChannelError("OCP_TRANSPORT", "OCP app shutdown timed out")),
            Math.max(0, timeoutMs),
          );
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.active.add(promise);
    return promise.finally(() => this.active.delete(promise));
  }

  private assertAccepting(): void {
    if (this.state === "stopping" || this.state === "stopped") {
      throw new OpenChannelError("OCP_TRANSPORT", `OCP app is ${this.state}`);
    }
  }

  private toActionError(error: unknown, actionId?: string): ActionError {
    if (error instanceof ActionError) {
      return error;
    }
    return new ActionError(error instanceof Error ? error.message : String(error), {
      actionId,
      cause: error,
      retryable: false,
    });
  }

  private toOpenChannelError(error: unknown, eventId?: string): OpenChannelError {
    return error instanceof OpenChannelError
      ? error
      : new OpenChannelError("OCP_ACTION", error instanceof Error ? error.message : String(error), {
          cause: error,
          eventId,
          stage: "processing",
        });
  }

  private serializeInput(input: unknown): string {
    if (input === undefined || typeof input === "function" || typeof input === "symbol") {
      throw new ValidationError("OCP action input must be JSON serializable");
    }
    try {
      return JSON.stringify(input);
    } catch (error) {
      throw new ValidationError("OCP action input must be JSON serializable", { cause: error });
    }
  }

  private serializeResult(result: unknown): string {
    if (result === undefined) {
      return "null";
    }
    try {
      return typeof result === "string" ? result : JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
}
