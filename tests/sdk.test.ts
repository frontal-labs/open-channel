import { create } from "@bufbuild/protobuf";
import { RuleBasedPolicyEngine } from "@openchannel/policy";
import { ChannelRefSchema } from "@openchannel/protocol";
import { ChannelGateway, OpenChannelRuntime } from "@openchannel/runtime";
import {
  createTestAgent,
  createTestChannelAdapter,
  createTestEvent,
  createTestEventStore,
  createTestHuman,
} from "@openchannel/testing";
import { AgentHost, eventType } from "ocp-sdk";
import { describe, expect, it } from "vitest";

describe("OCP agent SDK", () => {
  it("routes an inbound message and dispatches the agent reply", async () => {
    const adapter = createTestChannelAdapter();
    const runtime = new OpenChannelRuntime({
      eventStore: createTestEventStore(),
      policy: new RuleBasedPolicyEngine({ rules: [] }),
    });
    const gateway = new ChannelGateway(runtime, [adapter]);
    const host = new AgentHost({ gateway, runtime });
    const human = createTestHuman("human:gabriel", "Gabriel");
    const agent = createTestAgent("agent:support", "Support Agent");

    host.register({
      id: agent.id,
      name: agent.displayName,
      onMessage: async (context) => {
        await context.reply(`Received: ${context.message.text}`);
      },
      skills: [{ id: "support", name: "Support" }],
    });
    expect(host.agentCards().find((card) => card.id === agent.id)?.skills[0]?.id).toBe("support");
    host.attach();

    const inbound = createTestEvent({
      actor: human,
      channel: create(ChannelRefSchema, { channelId: "channel-1", provider: "test" }),
      recipient: agent,
      text: "Can you help?",
    });

    await runtime.process(inbound);

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0] && eventType(adapter.sent[0])).toBe("message.sent");
    if (adapter.sent[0].payload.case === "messageSent") {
      expect(adapter.sent[0].payload.value.text).toBe("Received: Can you help?");
    }
  });
});
