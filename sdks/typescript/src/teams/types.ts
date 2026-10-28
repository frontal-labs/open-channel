import type { ActorRef } from "@openchannelprotocol/protocol";
import type { ChannelDefinition } from "../types.js";

/** Outbound Teams message handed to a transport. Built from a `message.sent` event. */
export interface TeamsSendInput {
  /** Attachment payloads from the `message.sent` event, passed through unchanged. */
  attachments: unknown[];
  /** Teams conversation ID taken from the event's channel. */
  conversationId: string;
  /** Delivery key from the call options, or the event's own idempotency key. */
  idempotencyKey?: string;
  /** Message ID to reply to, taken from the event's thread ID. */
  replyToId?: string;
  signal?: AbortSignal;
  text: string;
}

/** Narrow transport port for Microsoft Teams delivery. The host owns auth and HTTP. */
export interface TeamsTransport {
  /** Posts one message. Resolves with the provider's message ID when it returns one. */
  sendMessage: (input: TeamsSendInput) => Promise<{ messageId?: string }>;
}

/** Inbound options shared by `teamsSource` and `teamsChannel`. */
export interface TeamsSourceOptions {
  /**
   * Maps a raw Teams user ID to an OCP actor, for example from a directory lookup. Without it,
   * senders become human actors with ID `teams:<userId>`.
   */
  actorResolver?: (id: string) => ActorRef | Promise<ActorRef>;
  /** Bot's own Teams user ID. Messages from it are dropped so the bot never answers itself. */
  botId?: string;
  /** Agent that receives inbound messages. AgentHost routes only by `recipient`, so without it the message reaches no agent. */
  recipient?: ActorRef;
}

/** Complete Teams channel configuration for `openChannel()`. */
export interface TeamsChannelOptions extends TeamsSourceOptions {
  /** Delivery port used by the sink for `message.sent` events. */
  transport: TeamsTransport;
}

/**
 * A Teams webhook request as seen by `verifyTeamsWebhook`. The `authorization` header must be
 * under its lowercase key, as Node's `IncomingMessage.headers` provides it.
 */
export interface TeamsWebhookRequest {
  headers: Record<string, string | undefined>;
}

/** OCP channel definition for Microsoft Teams. */
export type TeamsChannel = ChannelDefinition;
