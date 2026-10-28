import { describe, expect, it } from "vitest";
import { a2aSource, normalizeA2AEvent } from "../../src/a2a/index.js";

describe("@openchannelprotocol/sdk/a2a loop prevention", () => {
  it("drops inbound messages sent by the configured local agent", () => {
    const event = normalizeA2AEvent(
      { message: { parts: [{ text: "echo" }], sender: { id: "agent:self" } } },
      {},
      { localAgentId: "agent:self" },
    );

    expect(event).toEqual([]);
  });

  it("keeps messages from other senders when a local agent id is set", () => {
    const event = normalizeA2AEvent(
      { message: { parts: [{ text: "hello" }], sender: { id: "agent:peer" } } },
      {},
      { localAgentId: "agent:self" },
    );

    expect(Array.isArray(event)).toBe(false);
  });

  it("joins text parts with newlines and skips non-text parts", async () => {
    const source = a2aSource();
    const event = await source.normalize({
      message: {
        parts: [{ text: "one" }, { data: { ignored: true } }, { text: "two" }],
        sender: { id: "peer" },
      },
    });

    expect(
      Array.isArray(event)
        ? undefined
        : event.payload.case === "messageReceived" && event.payload.value.text,
    ).toBe("one\ntwo");
  });

  it("rejects non-object input as a validation error", async () => {
    const source = a2aSource();

    await expect(source.normalize("not json")).rejects.toMatchObject({
      details: { provider: "a2a", stage: "normalize" },
    });
  });
});
