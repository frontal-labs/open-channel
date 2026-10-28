import type { ActorRef } from "@openchannelprotocol/protocol";
import type { ChannelDefinition } from "../types.js";

/**
 * Provider-neutral inbound email, as produced by an SMTP, IMAP, or webhook transport.
 * `text` is required for a message to become an OCP event; HTML-only mail is dropped.
 */
export interface EmailMessage {
  /** Opaque attachment descriptors. Not carried into the OCP event. */
  attachments?: unknown[];
  cc?: string[];
  from: string;
  html?: string;
  /** Provider message id. Stored as `email.message_id` and used as `inReplyTo` on replies. */
  id?: string;
  /** Message-ID of the parent message; used as the thread id when `threadId` is absent. */
  inReplyTo?: string;
  /** Ancestor Message-IDs; the last entry is used as the thread id when nothing closer is set. */
  references?: string[];
  subject?: string;
  text: string;
  /** Explicit thread id; takes precedence over `inReplyTo` and `references`. */
  threadId?: string;
  to: string[];
}

/** Outbound email accepted by an `EmailTransport`. */
export interface EmailSendInput extends EmailMessage {
  /** Key the transport can use to deduplicate retried sends. Taken from the OCP event. */
  idempotencyKey?: string;
  /** Aborted when the gateway cancels the delivery; transports should stop the send. */
  signal?: AbortSignal;
}

/** Narrow transport port for outbound email delivery. Implement it with SMTP, an API, or a test double. */
export interface EmailTransport {
  /** Sends one message. Rejections are wrapped as retryable `TransportError`s by the sink. */
  sendEmail: (input: EmailSendInput) => Promise<{ messageId?: string }>;
}

/**
 * Inbound email source. `poll` must yield messages while `signal` is live and finish once it
 * aborts; `stop` releases the underlying connection and should also end a pending `poll`.
 */
export interface EmailPoller {
  poll: (signal: AbortSignal) => AsyncIterable<EmailMessage>;
  stop?: () => Promise<void> | void;
}

/** Inbound mailbox settings shared by email sources and channels. */
export interface EmailSourceOptions {
  /**
   * Maps a sender address to an actor. Defaults to a human actor with id `email:<address>`.
   * Use it to attach a directory identity; it runs once per inbound message.
   */
  actorResolver?: (address: string) => ActorRef | Promise<ActorRef>;
  /** Address this channel receives on. Messages are dropped when empty. Stored as `channelId`. */
  mailbox: string;
  /** Optional long-running inbound feed. Without it the source only handles host `receive()` calls. */
  poller?: EmailPoller;
  /** Agent that receives inbound messages. AgentHost routes only by `recipient`, so without it the message reaches no agent. */
  recipient?: ActorRef;
}

/** Complete email channel configuration for `openChannel()`. */
export interface EmailChannelOptions extends EmailSourceOptions {
  /** Outbound transport used by the sink for `message.sent` events. */
  transport: EmailTransport;
}

/** OCP channel definition for email. */
export type EmailChannel = ChannelDefinition;
