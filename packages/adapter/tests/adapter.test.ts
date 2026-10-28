import { createTestChannelAdapter, createTestEvent } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";

describe("@openchannelprotocol/adapter", () => {
  it("records outbound events in memory", async () => {
    const adapter = createTestChannelAdapter();
    const event = createTestEvent({ eventType: "message.sent", text: "hello" });

    await adapter.send(event);

    expect(adapter.provider).toBe("test");
    expect(adapter.sent).toEqual([event]);
  });
});
