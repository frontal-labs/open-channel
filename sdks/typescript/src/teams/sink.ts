import type { ChannelSink, DeliveryOptions, DeliveryReceipt } from "ocp-adapter";
import { OpenChannelError, TransportError } from "ocp-core";
import type { EventEnvelope } from "ocp-protocol";
import { deliveryReceipt } from "../delivery.js";

import type { TeamsTransport } from "./types.js";

/** Creates a Teams sink for `openChannel({ channels })`. */
export function teamsSink(transport: TeamsTransport): ChannelSink {
  return {
    provider: "microsoft-teams",
    send: async (event, options) => {
      try {
        return (
          (await sendMessage(transport, event, options)) ?? {
            deliveredAt: new Date(),
            eventId: event.eventId,
            provider: "microsoft-teams",
          }
        );
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new TransportError("Unable to deliver OCP event through microsoft-teams", {
          cause: error,
          eventId: event.eventId,
          provider: "microsoft-teams",
          retryable: true,
          stage: "delivery",
        });
      }
    },
  };
}

async function sendMessage(
  transport: TeamsTransport,
  event: EventEnvelope,
  options?: DeliveryOptions,
): Promise<DeliveryReceipt | undefined> {
  if (event.payload.case !== "messageSent") {
    return undefined;
  }
  const conversationId = event.channel?.channelId;
  if (!conversationId) {
    return undefined;
  }
  const result = await transport.sendMessage({
    attachments: event.payload.value.attachments,
    conversationId,
    idempotencyKey: options?.idempotencyKey ?? event.idempotencyKey,
    replyToId: event.channel?.threadId,
    signal: options?.signal,
    text: event.payload.value.text,
  });
  return deliveryReceipt("microsoft-teams", event, result.messageId);
}
