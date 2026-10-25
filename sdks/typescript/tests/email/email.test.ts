import { describe, expect, it } from "vitest";
import { emailSource } from "../../src/email/index.js";

describe("ocp-sdk/email", () => {
  it("normalizes an email and preserves threading metadata", async () => {
    const source = emailSource({ mailbox: "agent@example.com" });
    const event = await source.normalize({
      from: "person@example.com",
      id: "<message@example.com>",
      inReplyTo: "<root@example.com>",
      subject: "Question",
      text: "hello",
      to: ["agent@example.com"],
    });
    expect((event as { channel?: { provider: string; threadId: string } }).channel).toMatchObject({
      provider: "email",
      threadId: "<root@example.com>",
    });
  });
});
