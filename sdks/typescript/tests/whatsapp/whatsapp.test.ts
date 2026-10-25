import { describe, expect, it } from "vitest";
import { whatsappSource } from "../../src/whatsapp/index.js";

describe("ocp-sdk/whatsapp", () => {
  it("normalizes a WhatsApp Business message", async () => {
    const source = whatsappSource();
    const event = await source.normalize({
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
    expect((event as { channel?: { provider: string; address: string } }).channel).toMatchObject({
      address: "351900000000",
      provider: "whatsapp",
    });
  });
});
