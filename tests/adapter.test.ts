import { RuleBasedPolicyEngine } from "ocp-policy";
import { ChannelGateway, OpenChannelRuntime } from "ocp-runtime";
import {
  createTestAgent,
  createTestChannel,
  createTestChannelAdapter,
  createTestEvent,
  createTestEventStore,
} from "ocp-testing";
import { describe, expect, it } from "vitest";

describe("OCP channel gateway", () => {
  it("dispatches an outbound event to the adapter for its provider", async () => {
    const adapter = createTestChannelAdapter();
    const gateway = new ChannelGateway(
      new OpenChannelRuntime({
        eventStore: createTestEventStore(),
        policy: new RuleBasedPolicyEngine({ rules: [] }),
      }),
      [adapter],
    );
    const event = createTestEvent({
      actor: createTestAgent("agent:support", "Support Agent"),
      channel: createTestChannel("channel-1"),
      eventType: "message.sent",
      text: "Hello from OCP",
    });

    await gateway.dispatch(event);

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].eventId).toBe(event.eventId);
  });

  it("fails clearly when no provider adapter is registered", async () => {
    const gateway = new ChannelGateway(
      new OpenChannelRuntime({
        eventStore: createTestEventStore(),
        policy: new RuleBasedPolicyEngine({ rules: [] }),
      }),
    );
    const event = createTestEvent({
      channel: createTestChannel("channel-1", "thread-1", "missing"),
      eventType: "message.sent",
      text: "Hello",
    });

    await expect(gateway.dispatch(event)).rejects.toThrow(
      "No OCP adapter registered for provider: missing",
    );
  });
});
