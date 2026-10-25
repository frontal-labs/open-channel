import type { ActorRef } from "ocp-protocol";
import type { ChannelDefinition } from "../types.js";

/** Outbound message accepted by a Slack transport implementation. */
export interface SlackSendInput {
  /** Slack Block Kit or legacy attachments, passed through unchanged from `message.sent`. */
  attachments: unknown[];
  channelId: string;
  /** Taken from the delivery options, falling back to the OCP event's idempotency key. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  text: string;
  /** Slack `thread_ts`; omitted when the reply is not threaded. */
  threadId?: string;
}

/** Narrow port implemented by a Slack Web API client. */
export interface SlackTransport {
  /** Posts one message. Resolve with the Slack message `ts` as `messageId` when available. */
  postMessage: (input: SlackSendInput) => Promise<{ messageId?: string }>;
}

/** Configuration for Slack actor lookup. */
export interface SlackSourceOptions {
  /**
   * Maps a Slack user ID to the OCP actor recorded as `source`. Defaults to a human actor with
   * id `slack:<userId>`.
   */
  actorResolver?: (userId: string) => ActorRef | Promise<ActorRef>;
  /**
   * Bot user ID of this app. Messages from this user are dropped so the agent cannot reply to
   * itself.
   */
  botUserId?: string;
  /**
   * Agent that receives inbound messages. AgentHost routes only by `recipient`, so without it
   * a Slack message reaches no agent.
   */
  recipient?: ActorRef;
}

/** Complete Slack channel configuration for `openChannel({ channels })`. */
export interface SlackChannelOptions extends SlackSourceOptions {
  /** Slack Web API port used by the sink to post `message.sent` events. */
  transport: SlackTransport;
}

/** A verified Slack request suitable for the source normalizer. */
export interface SlackWebhookRequest {
  /** Raw request body exactly as received; it is the signed payload, so do not re-serialize it. */
  body: string | Uint8Array;
  /** HTTP headers keyed by lowercase name, as `verifySlackWebhook` reads them. */
  headers: Record<string, string | undefined>;
}

/** Creates a config-first OCP channel definition for Slack. */
export type SlackChannel = ChannelDefinition;
