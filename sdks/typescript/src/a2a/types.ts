import type { ActorRef } from "@openchannelprotocol/protocol";
import type { AgentCard, ChannelDefinition } from "../types.js";

/** Outbound A2A message. `taskId` and `contextId` correlate follow-up turns with the peer. */
export interface A2ASendInput {
  /** Peer context id. Set from the event's conversation id, which carries an `a2a:` prefix. */
  contextId?: string;
  /** Key the transport can use to deduplicate retried sends. */
  idempotencyKey?: string;
  /** Aborted when the gateway cancels the delivery. */
  signal?: AbortSignal;
  /** Peer task id, copied from the `a2a.task_id` extension when the event carries one. */
  taskId?: string;
  text: string;
}

/** Narrow transport port for sending messages to a remote A2A agent. */
export interface A2ATransport {
  /** Sends one message. `externalId` in the result is recorded on the delivery receipt. */
  sendMessage: (input: A2ASendInput) => Promise<{ externalId?: string }>;
}

/** Inbound settings for the A2A source. */
export interface A2ASourceOptions {
  /**
   * This agent's own id. Inbound messages from this sender are dropped, which prevents an agent
   * from answering its own messages when a peer echoes them back.
   */
  localAgentId?: string;
  /** Agent that receives inbound messages. AgentHost routes only by `recipient`, so without it the message reaches no agent. */
  recipient?: ActorRef;
}

/** Complete A2A channel configuration for `openChannel()`. */
export interface A2AChannelOptions extends A2ASourceOptions {
  /** Outbound transport used by the sink for `message.sent` events. */
  transport: A2ATransport;
}

/** Source of the A2A agent cards advertised to peers. */
export interface AgentCardRegistry {
  /** Returns the cards to advertise. Called on each discovery request, so it should be cheap. */
  agentCards: () => AgentCard[];
}

/** OCP channel definition for A2A. */
export type A2AChannel = ChannelDefinition;
