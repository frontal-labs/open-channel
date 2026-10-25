import type { EventEnvelope } from "@openchannel/protocol";
import { eventType } from "@openchannel/protocol";
import { describe, expect, it } from "vitest";
import { a2aSource } from "../../src/a2a/index.js";

describe("ocp-sdk/a2a", () => {
  it("normalizes A2A parts and preserves task context", async () => {
    const source = a2aSource();
    const event = await source.normalize({
      contextId: "context-1",
      message: { parts: [{ text: "hello" }], sender: { id: "remote" } },
      taskId: "task-1",
    });
    expect(
      (event as unknown as { extensions: Record<string, string> }).extensions["a2a.task_id"],
    ).toBe("task-1");
    expect(eventType(event as EventEnvelope)).toBe("message.received");
  });
});
