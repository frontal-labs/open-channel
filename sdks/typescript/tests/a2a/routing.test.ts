import { create } from "@bufbuild/protobuf";
import { ActorRefSchema, ActorType } from "@openchannelprotocol/protocol";
import { describe, expect, it } from "vitest";
import { a2aSource } from "../../src/a2a/index.js";

describe("@openchannelprotocol/sdk/a2a routing", () => {
  it("sets the configured recipient so AgentHost can route the message", async () => {
    const route = create(ActorRefSchema, { id: "agent:a2a-helper", type: ActorType.AGENT });
    const source = a2aSource({ recipient: route });
    const normalized = await source.normalize({
      contextId: "context-1",
      message: { parts: [{ text: "hello" }], sender: { id: "remote" } },
      taskId: "task-1",
    });
    const event = Array.isArray(normalized) ? normalized[0] : normalized;

    expect(event?.recipient?.id).toBe("agent:a2a-helper");
  });
});
