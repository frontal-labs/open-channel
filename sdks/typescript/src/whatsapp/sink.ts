import type { ChannelSink, DeliveryOptions, DeliveryReceipt } from "ocp-adapter";
import { OpenChannelError, TransportError } from "ocp-core";
import type { EventEnvelope } from "ocp-protocol";
import { deliveryReceipt } from "../delivery.js";

import type { WhatsAppTransport } from "./types.js";

/**
 * Creates a WhatsApp Business sink for `message.sent` events.
 *
 * Only `message.sent` events are sent. Other event types, and `message.sent` events with no
 * destination, resolve with a receipt without calling the transport. The destination is
 * `recipient.id`, falling back to `channel.address`.
 */
export function whatsappSink(transport: WhatsAppTransport, phoneNumberId: string): ChannelSink {
  return {
    provider: "whatsapp",
    send: async (event, options) => {
      try {
        return (
          (await sendMessage(transport, phoneNumberId, event, options)) ?? {
            deliveredAt: new Date(),
            eventId: event.eventId,
            provider: "whatsapp",
          }
        );
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new TransportError("Unable to deliver OCP event through whatsapp", {
          cause: error,
          eventId: event.eventId,
          provider: "whatsapp",
          retryable: true,
          stage: "delivery",
        });
      }
    },
  };
}

async function sendMessage(
  transport: WhatsAppTransport,
  phoneNumberId: string,
  event: EventEnvelope,
  options?: DeliveryOptions,
): Promise<DeliveryReceipt | undefined> {
  if (event.payload.case !== "messageSent") {
    return undefined;
  }
  const to = event.recipient?.id ?? event.channel?.address;
  if (!to) {
    return undefined;
  }
  const result = await transport.sendMessage({
    idempotencyKey: options?.idempotencyKey ?? event.idempotencyKey,
    phoneNumberId,
    signal: options?.signal,
    text: event.payload.value.text,
    to,
  });
  return deliveryReceipt("whatsapp", event, result.messageId);
}
