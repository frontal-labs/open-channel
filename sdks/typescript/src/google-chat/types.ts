import type { ActorRef } from "@openchannelprotocol/protocol";
import type { ChannelDefinition } from "../types.js";

/** Outbound Google Chat message accepted by a Chat API transport. */
export interface GoogleChatSendInput {
  attachments: unknown[];
  idempotencyKey?: string;
  signal?: AbortSignal;
  space: string;
  text: string;
  thread?: string;
}

/** Narrow transport port for Google Chat delivery. */
export interface GoogleChatTransport {
  createMessage: (input: GoogleChatSendInput) => Promise<{ messageId?: string }>;
}

/** Optional Google Chat actor lookup. */
export interface GoogleChatSourceOptions {
  actorResolver?: (id: string) => ActorRef | Promise<ActorRef>;
  appId?: string;
  /** Agent that receives inbound messages. AgentHost routes only by `recipient`, so without it the message reaches no agent. */
  recipient?: ActorRef;
}

/** Complete Google Chat channel configuration for `openChannel()`. */
export interface GoogleChatChannelOptions extends GoogleChatSourceOptions {
  transport: GoogleChatTransport;
}

/** A Google Chat webhook request with its headers. */
export interface GoogleChatWebhookRequest {
  headers: Record<string, string | undefined>;
}

/** OCP channel definition for Google Chat. */
export type GoogleChatChannel = ChannelDefinition;
