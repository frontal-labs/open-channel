import type { DeliveryReceipt } from "@openchannelprotocol/adapter";
import type { EventEnvelope } from "@openchannelprotocol/protocol";

/** Builds the delivery receipt a channel sink returns after a successful provider send. */
export function deliveryReceipt(
  provider: string,
  event: EventEnvelope,
  externalId?: string,
): DeliveryReceipt {
  return { deliveredAt: new Date(), eventId: event.eventId, externalId, provider };
}
