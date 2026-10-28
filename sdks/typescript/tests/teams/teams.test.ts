import type { EventEnvelope } from "@openchannelprotocol/protocol";
import { eventType } from "@openchannelprotocol/protocol";
import { describe, expect, it } from "vitest";
import { teamsSource } from "../../src/teams/index.js";

describe("@openchannelprotocol/sdk/teams", () => {
  it("normalizes a Teams message", async () => {
    const source = teamsSource();
    const event = await source.normalize({
      conversation: { id: "conversation-1" },
      from: { user: { displayName: "Alex", id: "user-1" } },
      id: "message-1",
      text: "hello",
      type: "message",
    });
    expect(Array.isArray(event)).toBe(false);
    expect(eventType(event as EventEnvelope)).toBe("message.received");
  });
});
