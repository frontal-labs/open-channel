import { describe, expect, it } from "vitest";

import {
  createTestChannelAdapter,
  createTestEvent,
  createTestEventBus,
  createTestEventStore,
} from "../src/index.js";

describe("ocp-testing state helpers", () => {
  it("creates an event bus fixture", async () => {
    const bus = createTestEventBus<string>();
    const values: string[] = [];
    bus.subscribe((value) => {
      values.push(value);
    });

    await bus.publish("event");

    expect(values).toEqual(["event"]);
  });

  it("creates an append-only event store fixture", async () => {
    const store = createTestEventStore();
    const event = createTestEvent({ eventId: "stored" });

    await store.append(event);

    expect(await store.has("stored")).toBe(true);
    expect(await store.all()).toEqual([event]);
  });

  it("creates independent channel adapters that record deliveries", async () => {
    const first = createTestChannelAdapter();
    const second = createTestChannelAdapter();
    const event = createTestEvent({ eventType: "message.sent" });

    const receipt = await first.send(event);

    expect(receipt).toMatchObject({ eventId: event.eventId, provider: "test" });
    expect(first.sent).toEqual([event]);
    expect(second.sent).toEqual([]);
  });
});
