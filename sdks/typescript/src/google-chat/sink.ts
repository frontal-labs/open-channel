import type { ChannelSink, DeliveryOptions, DeliveryReceipt } from "ocp-adapter";
import { OpenChannelError, TransportError } from "ocp-core";
import type { EventEnvelope } from "ocp-protocol";
import { deliveryReceipt } from "../delivery.js";

import type { GoogleChatTransport } from "./types.js";

/** Creates a Google Chat sink for `openChannel({ channels })`. */
export function googleChatSink(transport: GoogleChatTransport): ChannelSink {
  return {
    provider: "google-chat",
    send: async (event, options) => {
      try {
        return (
          (await createMessage(transport, event, options)) ?? {
            deliveredAt: new Date(),
            eventId: event.eventId,
            provider: "google-chat",
          }
        );
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new TransportError("Unable to deliver OCP event through google-chat", {
          cause: error,
          eventId: event.eventId,
          provider: "google-chat",
          retryable: true,
          stage: "delivery",
        });
      }
    },
  };
}

async function createMessage(
  transport: GoogleChatTransport,
  event: EventEnvelope,
  options?: DeliveryOptions,
): Promise<DeliveryReceipt | undefined> {
  if (event.payload.case !== "messageSent") {
    return undefined;
  }
  const space = event.channel?.channelId;
  if (!space) {
    return undefined;
  }
  const result = await transport.createMessage({
    attachments: event.payload.value.attachments,
    idempotencyKey: options?.idempotencyKey ?? event.idempotencyKey,
    signal: options?.signal,
    space,
    text: event.payload.value.text,
    thread: event.channel?.threadId,
  });
  return deliveryReceipt("google-chat", event, result.messageId);
}
