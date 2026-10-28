import { create } from "@bufbuild/protobuf";
import type { DeliveryReceipt } from "@openchannelprotocol/adapter";
import { ActionError, ConflictError, OpenChannelError } from "@openchannelprotocol/core";
import {
  type ActorRef,
  ActorRefSchema,
  ActorType,
  type EventEnvelope,
  type MessageReceived,
  MessageSentSchema,
  newEvent,
} from "@openchannelprotocol/protocol";
import type { ChannelGateway, OpenChannelRuntime } from "@openchannelprotocol/runtime";

import { consoleLogger } from "./logger.js";
import type {
  ActionRequestOptions,
  ActionResult,
  AgentCard,
  AgentContext,
  AgentDefinition,
  AgentLogger,
  ReplyOptions,
} from "./types.js";

/** Requests an action on behalf of an agent. Supplied by the application, which owns the registry. */
export type ActionRequester = <TInput, TResult>(
  agent: ActorRef,
  inbound: EventEnvelope,
  type: string,
  input: TInput,
  options?: ActionRequestOptions,
) => Promise<ActionResult<TResult>>;

/** Dependencies for an agent host. */
export interface AgentHostOptions {
  actionRequester?: ActionRequester;
  agents?: AgentDefinition[];
  gateway: ChannelGateway;
  logger?: AgentLogger;
  maxConcurrentConversations?: number;
  onDelivery?: (receipt: DeliveryReceipt) => void | Promise<void>;
  onError?: (error: OpenChannelError) => void | Promise<void>;
  runtime: OpenChannelRuntime;
}

/** Hosts agents and routes `message.received` events to them, one message per conversation at a time. */
export class AgentHost {
  private readonly runtime: OpenChannelRuntime;
  private readonly gateway: ChannelGateway;
  private readonly actionRequester: ActionRequester;
  private readonly onDelivery: AgentHostOptions["onDelivery"];
  private readonly onError: AgentHostOptions["onError"];
  private readonly logger: AgentLogger;
  private readonly maxConcurrentConversations: number;
  private readonly agents: Record<string, AgentDefinition> = Object.create(null);
  private readonly queues: Partial<Record<string, Promise<void>>> = Object.create(null);
  private runningConversations = 0;
  private readonly concurrencyWaiters: Array<() => void> = [];
  private detachSubscription?: () => void;

  constructor(options: AgentHostOptions) {
    this.runtime = options.runtime;
    this.gateway = options.gateway;
    this.actionRequester =
      options.actionRequester ??
      (() =>
        Promise.reject(new ActionError("OCP action handling is not configured for this host")));
    this.onDelivery = options.onDelivery;
    this.onError = options.onError;
    this.logger = options.logger ?? consoleLogger;
    this.maxConcurrentConversations = Math.max(
      1,
      options.maxConcurrentConversations ?? Number.POSITIVE_INFINITY,
    );
    for (const agent of options.agents ?? []) {
      this.register(agent);
    }
  }

  register(agent: AgentDefinition): void {
    if (agent.id in this.agents) {
      throw new ConflictError("OCP agent", agent.id);
    }
    this.agents[agent.id] = agent;
  }

  agentCards(): AgentCard[] {
    return Object.values(this.agents).map((agent) => this.toCard(agent));
  }

  attach(): void {
    if (this.detachSubscription) {
      return;
    }
    const unsubscribe = this.runtime.subscribe(async (event) => {
      try {
        await this.handle(event);
      } catch (error) {
        await this.onError?.(
          error instanceof OpenChannelError
            ? error
            : new OpenChannelError(
                "OCP_ACTION",
                error instanceof Error ? error.message : String(error),
                {
                  cause: error,
                  eventId: event.eventId,
                  stage: "processing",
                },
              ),
        );
      }
    });
    this.detachSubscription = () => {
      unsubscribe();
      this.detachSubscription = undefined;
    };
  }

  detach(): void {
    this.detachSubscription?.();
  }

  /** Routes one event to its recipient agent. Returns false when the event is not a message for a registered agent. */
  async handle(event: EventEnvelope): Promise<boolean> {
    if (event.payload.case !== "messageReceived") {
      return false;
    }
    const message = event.payload.value;
    const key = this.conversationKey(event);
    const previous = this.queues[key] ?? Promise.resolve();
    const current = previous.then(() => this.handleNow(event, message));
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.queues[key] = tail;
    try {
      return await current;
    } finally {
      if (this.queues[key] === tail) {
        delete this.queues[key];
      }
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.allSettled(Object.values(this.queues));
  }

  private async handleNow(event: EventEnvelope, message: MessageReceived): Promise<boolean> {
    const agentId = event.recipient?.id;
    const definition: AgentDefinition | undefined = agentId ? this.agents[agentId] : undefined;
    if (!definition) {
      return false;
    }
    const agent = this.toActor(definition);
    await this.acquireConversation();
    try {
      const context: AgentContext = {
        agent,
        channel: event.channel,
        conversation: event.conversation,
        event,
        logger: this.logger,
        message,
        reply: (text, options) => this.reply(agent, event, text, options),
        request: (type, input, options) => this.actionRequester(agent, event, type, input, options),
        runtime: this.runtime,
      };
      await definition.onMessage(context);
      return true;
    } finally {
      this.releaseConversation();
    }
  }

  private async reply(
    agent: ActorRef,
    inbound: EventEnvelope,
    text: string,
    options: ReplyOptions = {},
  ): Promise<EventEnvelope> {
    const event = newEvent({
      actor: agent,
      causationId: inbound.eventId,
      channel: options.channel ?? inbound.channel,
      conversation: options.conversation ?? inbound.conversation,
      correlationId: inbound.correlationId || inbound.eventId,
      payload: {
        case: "messageSent",
        value: create(MessageSentSchema, { text }),
      },
      recipient: options.recipient ?? inbound.actor,
      source: agent,
    });
    await this.runtime.process(event);
    const receipt = await this.gateway.dispatch(event);
    if (receipt) {
      await this.onDelivery?.(receipt);
    }
    return event;
  }

  private toActor(definition: AgentDefinition): ActorRef {
    return create(ActorRefSchema, {
      capabilities: definition.actorCapabilities ?? [],
      displayName: definition.name,
      id: definition.id,
      type: ActorType.AGENT,
    });
  }

  private acquireConversation(): Promise<void> {
    if (this.runningConversations < this.maxConcurrentConversations) {
      this.runningConversations += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.concurrencyWaiters.push(() => {
        this.runningConversations += 1;
        resolve();
      });
    });
  }

  private releaseConversation(): void {
    const next = this.concurrencyWaiters.shift();
    if (next) {
      next();
    } else {
      this.runningConversations = Math.max(0, this.runningConversations - 1);
    }
  }

  private conversationKey(event: EventEnvelope): string {
    if (event.conversation?.id) {
      return `conversation:${event.conversation.id}`;
    }
    if (event.channel?.provider && event.channel.channelId) {
      return `channel:${event.channel.provider}:${event.channel.channelId}:${event.channel.threadId}`;
    }
    return `event:${event.eventId}`;
  }

  private toCard(definition: AgentDefinition): AgentCard {
    return {
      capabilities: definition.capabilities ?? {},
      description: definition.description,
      id: definition.id,
      name: definition.name,
      skills: definition.skills ?? [],
      url: definition.url,
      version: definition.version,
    };
  }
}
