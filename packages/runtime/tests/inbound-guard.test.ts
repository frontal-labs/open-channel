import { RuleBasedPolicyEngine } from "@openchannelprotocol/policy";
import { createTestEvent, createTestEventStore } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";
import { OpenChannelRuntime, SYSTEM_ACTOR } from "../src/index.js";

function runtime(): OpenChannelRuntime {
  return new OpenChannelRuntime({
    eventStore: createTestEventStore(),
    policy: new RuleBasedPolicyEngine({ rules: [] }),
  });
}

describe("inbound event guard", () => {
  it("rejects runtime-only event types submitted from outside", async () => {
    const rt = runtime();
    const outcome = createTestEvent({ eventType: "action.executed" });

    await expect(rt.process(outcome)).rejects.toThrow("produced by the runtime");
  });

  it("rejects an inbound event that claims the runtime actor as its source", async () => {
    const rt = runtime();
    const forged = createTestEvent({ eventType: "message.received", source: SYSTEM_ACTOR });

    await expect(rt.process(forged)).rejects.toThrow("cannot claim the runtime actor");
  });

  it("still records SDK-produced outcomes through the internal path", async () => {
    const rt = runtime();
    const outcome = createTestEvent({ eventType: "action.executed", source: SYSTEM_ACTOR });

    await expect(rt.processInternal(outcome)).resolves.toMatchObject({ duplicate: false });
  });
});
