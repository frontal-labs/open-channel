import { create } from "@bufbuild/protobuf";
import { ActorRefSchema, ActorType } from "@openchannelprotocol/protocol";
import { describe, expect, it } from "vitest";
import { teamsSource } from "../../src/teams/index.js";

describe("@openchannelprotocol/sdk/teams routing", () => {
  it("sets the configured recipient so AgentHost can route the message", async () => {
    const route = create(ActorRefSchema, {
      id: "agent:microsoft-teams-helper",
      type: ActorType.AGENT,
    });
    const source = teamsSource({ recipient: route });
    const normalized = await source.normalize({
      conversation: { id: "conversation-1" },
      from: { user: { displayName: "Alex", id: "user-1" } },
      id: "message-1",
      text: "hello",
      type: "message",
    });
    const event = Array.isArray(normalized) ? normalized[0] : normalized;

    expect(event?.recipient?.id).toBe("agent:microsoft-teams-helper");
  });
});
