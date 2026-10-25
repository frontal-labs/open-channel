import { create } from "@bufbuild/protobuf";
import { ActorRefSchema, ActorType, eventType } from "@openchannel/protocol";
import { createTestEvent } from "@openchannel/testing";
import { describe, expect, it } from "vitest";
import { slackSink, slackSource } from "../../src/slack/index.js";

describe("ocp-sdk/slack", () => {
  it("normalizes a Slack message through the ChannelSource contract", async () => {
    const source = slackSource();
    const normalized = await source.normalize({
      event: { channel: "C123", text: "hello", ts: "123.456", type: "message", user: "U123" },
      event_id: "Ev123",
      type: "event_callback",
    });
    const event = Array.isArray(normalized) ? normalized[0] : normalized;

    expect(event && eventType(event)).toBe("message.received");
    expect(event?.channel?.provider).toBe("slack");
    expect(event?.payload.case).toBe("messageReceived");
  });

  it("uses the event id and idempotency key from receive metadata", async () => {
    const source = slackSource();
    const normalized = await source.normalize(
      { event: { channel: "C123", text: "hi", ts: "1.2", type: "message", user: "U123" } },
      { eventId: "provider-event", idempotencyKey: "provider-event" },
    );
    const event = Array.isArray(normalized) ? normalized[0] : normalized;

    expect(event?.eventId).toBe("provider-event");
    expect(event?.idempotencyKey).toBe("provider-event");
  });

  it("routes normalized messages to the configured recipient agent", async () => {
    const recipient = create(ActorRefSchema, { id: "agent:slack-helper", type: ActorType.AGENT });
    const source = slackSource({ recipient });
    const normalized = await source.normalize({
      event: { channel: "C123", text: "hi", ts: "1.1", type: "message", user: "U123" },
      event_id: "Ev-route",
      type: "event_callback",
    });
    const event = Array.isArray(normalized) ? normalized[0] : normalized;

    expect(event?.recipient?.id).toBe("agent:slack-helper");
  });

  it("sends message.sent through an injected Slack transport", async () => {
    const calls: string[] = [];
    const sink = slackSink({
      postMessage: ({ text }) => {
        calls.push(text);
        return Promise.resolve({ messageId: "ts:1" });
      },
    });
    const event = createTestEvent({ eventType: "message.sent", text: "hello" });
    await sink.send(event);
    expect(calls).toEqual(["hello"]);
  });
});
