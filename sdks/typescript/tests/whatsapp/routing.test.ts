import { create } from "@bufbuild/protobuf";
import { ActorRefSchema, ActorType } from "@openchannel/protocol";
import { describe, expect, it } from "vitest";
import { whatsappSource } from "../../src/whatsapp/index.js";

describe("ocp-sdk/whatsapp routing", () => {
  it("sets the configured recipient so AgentHost can route the message", async () => {
    const route = create(ActorRefSchema, { id: "agent:whatsapp-helper", type: ActorType.AGENT });
    const source = whatsappSource({ recipient: route });
    const normalized = await source.normalize({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "351900000000", id: "wamid.1", text: { body: "hello" }, type: "text" },
                ],
                metadata: { phone_number_id: "phone-1" },
              },
            },
          ],
        },
      ],
    });
    const event = Array.isArray(normalized) ? normalized[0] : normalized;

    expect(event?.recipient?.id).toBe("agent:whatsapp-helper");
  });
});
