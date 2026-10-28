import type { ChannelSink, DeliveryOptions, DeliveryReceipt } from "@openchannelprotocol/adapter";
import { OpenChannelError, TransportError } from "@openchannelprotocol/core";
import type { EventEnvelope } from "@openchannelprotocol/protocol";
import { deliveryReceipt } from "../delivery.js";

import type { EmailTransport } from "./types.js";

/**
 * Creates the email sink for OCP `message.sent` events.
 *
 * Replies go to `event.recipient.id` (or `channel.address`), with `Re: <subject>` when the
 * inbound subject is known and `inReplyTo` set from `email.message_id`. Failures from the
 * transport are rethrown as retryable `TransportError`s.
 */
export function emailSink(transport: EmailTransport): ChannelSink {
  return {
    provider: "email",
    send: async (event, options) => {
      try {
        return (
          (await sendEmail(transport, event, options)) ?? {
            deliveredAt: new Date(),
            eventId: event.eventId,
            provider: "email",
          }
        );
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new TransportError("Unable to deliver OCP event through email", {
          cause: error,
          eventId: event.eventId,
          provider: "email",
          retryable: true,
          stage: "delivery",
        });
      }
    },
  };
}

/** Maps one event to a transport call. Returns `undefined` when there is nothing to send. */
async function sendEmail(
  transport: EmailTransport,
  event: EventEnvelope,
  options?: DeliveryOptions,
): Promise<DeliveryReceipt | undefined> {
  if (event.payload.case !== "messageSent") {
    return undefined;
  }
  const recipient = event.recipient?.id ?? event.channel?.address;
  if (!recipient) {
    return undefined;
  }
  const result = await transport.sendEmail({
    from: event.actor?.id ?? "",
    id: event.eventId,
    idempotencyKey: options?.idempotencyKey ?? event.idempotencyKey,
    inReplyTo: event.extensions["email.message_id"],
    signal: options?.signal,
    subject: event.extensions["email.subject"]
      ? `Re: ${event.extensions["email.subject"]}`
      : "OCP message",
    text: event.payload.value.text,
    to: [recipient],
  });
  return deliveryReceipt("email", event, result.messageId);
}
