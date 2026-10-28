import type { ActorRef } from "@openchannelprotocol/protocol";
import type { ChannelDefinition } from "../types.js";

/** Outbound WhatsApp text message accepted by a transport. */
export interface WhatsAppSendInput {
  /** Taken from the delivery options, falling back to the OCP event's idempotency key. */
  idempotencyKey?: string;
  /** Business phone number ID the message is sent from (the Graph API path segment). */
  phoneNumberId: string;
  signal?: AbortSignal;
  text: string;
  /** Recipient in the form WhatsApp expects in `to` (the sender's phone number). */
  to: string;
}

/** Narrow transport port for WhatsApp Business Cloud API delivery. */
export interface WhatsAppTransport {
  /** Sends one text message. Resolve with the WhatsApp message ID as `messageId` when available. */
  sendMessage: (input: WhatsAppSendInput) => Promise<{ messageId?: string }>;
}

/** Optional WhatsApp actor lookup and business number settings. */
export interface WhatsAppSourceOptions {
  /**
   * Maps a sender phone number to the OCP actor recorded as `source`. Defaults to a human actor
   * with id `whatsapp:<phone>`.
   */
  actorResolver?: (phone: string) => ActorRef | Promise<ActorRef>;
  /**
   * Only accept messages delivered to this business phone number ID. Other numbers on the same
   * app are ignored instead of being normalized.
   */
  businessPhoneNumberId?: string;
  /** Agent that receives inbound messages. AgentHost routes only by `recipient`, so without it the message reaches no agent. */
  recipient?: ActorRef;
}

/** Complete WhatsApp channel configuration for `openChannel()`. */
export interface WhatsAppChannelOptions extends WhatsAppSourceOptions {
  /** Business phone number ID that outbound messages are sent from. */
  phoneNumberId: string;
  /** Graph API port used by the sink to send `message.sent` events. */
  transport: WhatsAppTransport;
}

/** A WhatsApp webhook request with its raw body and headers. */
export interface WhatsAppWebhookRequest {
  /** Raw request body exactly as received; the signature is computed over these bytes. */
  body: string | Uint8Array;
  /** HTTP headers keyed by lowercase name, as `verifyWhatsAppWebhook` reads them. */
  headers: Record<string, string | undefined>;
}

/** OCP channel definition for WhatsApp. */
export type WhatsAppChannel = ChannelDefinition;
