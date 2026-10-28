import type { ChannelSink, ChannelSource, DeliveryReceipt, ReceiveMetadata } from "@openchannelprotocol/adapter";
import type { ActionError, OpenChannelError } from "@openchannelprotocol/core";
import type { PolicyEngine } from "@openchannelprotocol/policy";
import type {
  ActionRequest,
  ActorRef,
  ChannelRef,
  ConversationRef,
  EventEnvelope,
  EventType,
  MessageReceived,
} from "@openchannelprotocol/protocol";
import type {
  ChannelGateway,
  Clock,
  EventStore,
  OpenChannelRuntime,
  RuntimeResult,
  SubmitActionInput,
} from "@openchannelprotocol/runtime";

/** A discoverable skill an agent advertises. */
export interface AgentSkill {
  description?: string;
  examples?: string[];
  id: string;
  name: string;
  tags?: string[];
}

/** Capabilities an agent advertises in its card. */
export interface AgentCapabilities {
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  streaming?: boolean;
}

/** An agent registration: identity, discovery metadata, and the message handler. */
export interface AgentDefinition {
  actorCapabilities?: string[];
  capabilities?: AgentCapabilities;
  description?: string;
  id: string;
  name: string;
  /** Called once per inbound message. Conversations are handled one message at a time. */
  onMessage: (ctx: AgentContext) => void | Promise<void>;
  skills?: AgentSkill[];
  url?: string;
  version?: string;
}

/** Discovery metadata for an agent, returned by `ocp.agentCards()`. */
export interface AgentCard {
  capabilities: AgentCapabilities;
  description?: string;
  id: string;
  name: string;
  skills: AgentSkill[];
  url?: string;
  version?: string;
}

/** Optional routing overrides for a reply or an action request. */
export interface ReplyOptions {
  channel?: ChannelRef;
  conversation?: ConversationRef;
  recipient?: ActorRef;
}

/** Structured logging surface available to an agent. */
export interface AgentLogger {
  debug: (message: string, details?: Record<string, unknown>) => void;
  error: (message: string, details?: Record<string, unknown>) => void;
  info: (message: string, details?: Record<string, unknown>) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
}

/** Optional routing and approval details for an action request. */
export interface ActionRequestOptions {
  actionId?: string;
  approver?: ActorRef;
  channel?: ChannelRef;
  conversation?: ConversationRef;
  deadline?: Date;
  reason?: string;
  recipient?: ActorRef;
  target?: string;
}

/** Outcome of an action request. Exactly one status applies. */
export type ActionResult<TResult> =
  | { actionId: string; status: "blocked"; reason: string }
  | { actionId: string; status: "approval_required"; approvalId: string }
  | { actionId: string; status: "executed"; result: TResult }
  | { actionId: string; status: "failed"; error: ActionError };

/** The context an agent receives for one inbound message. */
export interface AgentContext {
  /** The agent's own identity. */
  agent: ActorRef;
  channel?: ChannelRef;
  conversation?: ConversationRef;
  /** The raw inbound envelope. */
  event: EventEnvelope;
  logger: AgentLogger;
  /** The decoded `message.received` payload. */
  message: MessageReceived;
  /** Sends a reply through the channel that delivered the message. */
  reply: (text: string, options?: ReplyOptions) => Promise<EventEnvelope>;
  /** Requests a policy-controlled action. */
  request: <TInput, TResult = unknown>(
    type: string,
    input: TInput,
    options?: ActionRequestOptions,
  ) => Promise<ActionResult<TResult>>;
  runtime: OpenChannelRuntime;
}

/** Context passed to an action's `execute` function. */
export interface ActionExecutionContext {
  actor: ActorRef;
  event?: EventEnvelope;
  request: <TInput, TResult = unknown>(
    type: string,
    input: TInput,
    options?: ActionRequestOptions,
  ) => Promise<ActionResult<TResult>>;
  runtime: OpenChannelRuntime;
}

type ActionExecutor<TInput, TResult> = {
  // biome-ignore lint/style/useConsistentMethodSignatures: Typed definitions enter an erased registry through this bivariant boundary.
  bivarianceHack(input: TInput, context: ActionExecutionContext): TResult | Promise<TResult>;
}["bivarianceHack"];

/** A policy-controlled operation an agent can request. */
export interface ActionDefinition<TInput, TResult> {
  execute: ActionExecutor<TInput, TResult>;
  type: string;
  /** Narrows untrusted input to `TInput`, throwing when it is invalid. */
  validate: (input: unknown) => TInput;
}

/** Declares an action with its input and result types. */
export function action<TInput, TResult>(
  definition: ActionDefinition<TInput, TResult>,
): ActionDefinition<TInput, TResult> {
  return definition;
}

/** Input for an action request made by the runtime itself, not from an agent handler. */
export type AgentActionInput = Omit<SubmitActionInput, "actor" | "channel" | "conversation"> & {
  channel?: SubmitActionInput["channel"];
  conversation?: SubmitActionInput["conversation"];
};

/** A channel registration: an inbound `source`, an outbound `sink`, or both. */
export interface ChannelDefinition {
  provider: string;
  sink?: ChannelSink;
  source?: ChannelSource;
}

/** Lifecycle and delivery hooks. Each is optional and runs after the matching step. */
export interface OpenChannelHooks {
  onActionCompleted?: (result: ActionResult<unknown>) => void | Promise<void>;
  onActionStarted?: (action: ActionRequest) => void | Promise<void>;
  onDelivery?: (receipt: DeliveryReceipt) => void | Promise<void>;
  onError?: (error: OpenChannelError) => void | Promise<void>;
  onEventAccepted?: (event: EventEnvelope) => void | Promise<void>;
  onEventProcessed?: (event: EventEnvelope) => void | Promise<void>;
}

/** Result of accepting an event. `duplicate` is true when the event was already accepted. */
export type IngestResult = RuntimeResult;

/** Options for `openChannel()`. `policy` and `store` are required. */
export interface OpenChannelOptions {
  actions?: ActionDefinition<unknown, unknown>[];
  agents?: AgentDefinition[];
  /** Time before an unanswered approval expires. Defaults to 60 seconds. */
  approvalTimeoutMs?: number;
  /** Default approver for action requests that name none. */
  approver?: ActorRef;
  channels?: ChannelDefinition[];
  clock?: Clock;
  /** Maximum conversations handled at once. Unlimited by default. */
  concurrency?: number;
  hooks?: OpenChannelHooks;
  /** Logger handed to agents as `ctx.logger`. Defaults to `consoleLogger`. */
  logger?: AgentLogger;
  policy: PolicyEngine;
  runtimeActor?: ActorRef;
  /** Durable event store. Pass an implementation explicitly, for example the postgres extension. */
  store: EventStore;
}

/** A running OCP application. Created with `openChannel()`. */
export interface OpenChannel {
  /** Registers an action after construction. */
  addAction: <TInput, TResult>(action: ActionDefinition<TInput, TResult>) => void;
  /** Registers an agent after construction. */
  addAgent: (agent: AgentDefinition) => void;
  /** Registers a channel after construction. */
  addChannel: (channel: ChannelDefinition) => void;
  /** Discovery metadata for every registered agent. */
  agentCards: () => AgentCard[];
  approve: (approvalId: string, approver: ActorRef, reason?: string) => Promise<RuntimeResult>;
  deny: (approvalId: string, approver: ActorRef, reason?: string) => Promise<RuntimeResult>;
  readonly gateway: ChannelGateway;
  ingest: (event: EventEnvelope) => Promise<IngestResult>;
  /** Subscribes to every accepted event of one type. Returns an unsubscribe function. */
  on: (type: EventType, handler: (event: EventEnvelope) => void | Promise<void>) => () => void;
  /** Accepts input from a provider's channel source. */
  receive: (
    provider: string,
    input: unknown,
    metadata?: ReceiveMetadata,
  ) => Promise<IngestResult[]>;
  readonly runtime: OpenChannelRuntime;
  start: () => Promise<void>;
  stop: (options?: { timeoutMs?: number }) => Promise<void>;
  /** The durable event store, for audit queries. */
  readonly store: EventStore;
}
