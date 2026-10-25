import type { EventEnvelope } from "ocp-protocol";

/** Delivery options accepted by a test channel, matching the adapter contract. */
export interface TestDeliveryOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Receipt returned by a test channel after an outbound event is accepted. */
export interface TestDeliveryReceipt {
  deliveredAt: Date;
  eventId: string;
  externalId?: string;
  provider: string;
}

/**
 * Channel sink fixture that records every delivered event. It is structurally compatible with the
 * adapter `ChannelSink` contract.
 */
export interface TestChannelAdapter {
  readonly provider: "test";
  send: (event: EventEnvelope, options?: TestDeliveryOptions) => Promise<TestDeliveryReceipt>;
  /** Delivered events, in delivery order. */
  readonly sent: EventEnvelope[];
}

/** Creates a recording channel adapter for tests. Each call returns an independent adapter. */
export function createTestChannelAdapter(): TestChannelAdapter {
  const sent: EventEnvelope[] = [];
  return {
    provider: "test",
    send(event) {
      sent.push(event);
      return Promise.resolve({ deliveredAt: new Date(), eventId: event.eventId, provider: "test" });
    },
    sent,
  };
}
