import type { ChannelSink, DeliveryOptions, DeliveryReceipt } from "ocp-adapter";
import { OpenChannelError, TransportError } from "ocp-core";
import type { EventEnvelope } from "ocp-protocol";
import { deliveryReceipt } from "../delivery.js";

import type { A2ATransport } from "./types.js";

/**
 * Creates the A2A `ChannelSink` for OCP `message.sent` events.
 * Transport failures are rethrown as retryable `TransportError`s.
 */
export function a2aSink(transport: A2ATransport): ChannelSink {
  return {
    provider: "a2a",
    send: async (event, options) => {
      try {
        return (
          (await sendMessage(transport, event, options)) ?? {
            deliveredAt: new Date(),
            eventId: event.eventId,
            provider: "a2a",
          }
        );
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new TransportError("Unable to deliver OCP event through a2a", {
          cause: error,
          eventId: event.eventId,
          provider: "a2a",
          retryable: true,
          stage: "delivery",
        });
      }
    },
  };
}

/**
 * Maps one event to a transport call. Returns `undefined` for any event that is not
 * `message.sent`; the sink then reports a receipt without sending anything.
 */
async function sendMessage(
  transport: A2ATransport,
  event: EventEnvelope,
  options?: DeliveryOptions,
): Promise<DeliveryReceipt | undefined> {
  if (event.payload.case !== "messageSent") {
    return undefined;
  }
  const result = await transport.sendMessage({
    contextId: event.conversation?.id,
    idempotencyKey: options?.idempotencyKey ?? event.idempotencyKey,
    signal: options?.signal,
    taskId: event.extensions["a2a.task_id"],
    text: event.payload.value.text,
  });
  return deliveryReceipt("a2a", event, result.externalId);
}
