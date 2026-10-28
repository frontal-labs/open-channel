import type { ChannelSink, DeliveryOptions, DeliveryReceipt } from "@openchannelprotocol/adapter";
import { OpenChannelError, TransportError } from "@openchannelprotocol/core";
import type { EventEnvelope } from "@openchannelprotocol/protocol";
import { deliveryReceipt } from "../delivery.js";

import type { SlackTransport } from "./types.js";

/** Creates a Slack `ChannelSink` for `openChannel({ channels })`. */
export function slackSink(transport: SlackTransport): ChannelSink {
  return {
    provider: "slack",
    send: async (event, options) => {
      try {
        return (
          (await postMessage(transport, event, options)) ?? {
            deliveredAt: new Date(),
            eventId: event.eventId,
            provider: "slack",
          }
        );
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new TransportError("Unable to deliver OCP event through slack", {
          cause: error,
          eventId: event.eventId,
          provider: "slack",
          retryable: true,
          stage: "delivery",
        });
      }
    },
  };
}

async function postMessage(
  transport: SlackTransport,
  event: EventEnvelope,
  options?: DeliveryOptions,
): Promise<DeliveryReceipt | undefined> {
  if (event.payload.case !== "messageSent") {
    return undefined;
  }
  const channelId = event.channel?.channelId;
  if (!channelId) {
    return undefined;
  }
  const message = event.payload.value;
  const result = await transport.postMessage({
    attachments: message.attachments,
    channelId,
    idempotencyKey: options?.idempotencyKey ?? event.idempotencyKey,
    signal: options?.signal,
    text: message.text,
    threadId: event.channel?.threadId,
  });
  return deliveryReceipt("slack", event, result.messageId);
}
