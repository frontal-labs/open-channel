import { describe, expect, it } from "vitest";
import { googleChatSource } from "../../src/google-chat/index.js";

describe("ocp-sdk/google-chat", () => {
  it("normalizes a Google Chat message", async () => {
    const source = googleChatSource();
    const event = await source.normalize({
      eventTime: "2026-10-19T14:00:00Z",
      message: {
        name: "spaces/1/messages/1",
        sender: { displayName: "Alex", name: "users/1" },
        text: "hello",
        thread: { name: "spaces/1/threads/1" },
      },
      space: { name: "spaces/1" },
      type: "MESSAGE",
    });
    expect(Array.isArray(event)).toBe(false);
    expect((event as { channel?: { provider: string } }).channel?.provider).toBe("google-chat");
  });
});
