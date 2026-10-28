import { ActorType } from "@openchannelprotocol/protocol";
import { createTestAgent, createTestHuman } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";
import { RuleBasedPolicyEngine } from "../src/index.js";

describe("@openchannelprotocol/policy", () => {
  it("evaluates the first matching rule and supports recipient constraints", () => {
    const manager = createTestHuman("human:manager");
    const engine = new RuleBasedPolicyEngine({
      rules: [
        {
          actionType: "send_reply",
          allowed: true,
          id: "manager-review",
          recipientId: manager.id,
          requiresApproval: true,
        },
      ],
    });

    const decision = engine.evaluate({
      actionType: "send_reply",
      actor: createTestAgent(),
      recipient: manager,
    });

    expect(decision).toMatchObject({
      allowed: true,
      approvalRequired: true,
      policyId: "manager-review",
    });
  });

  it("falls back to a denied decision", () => {
    const engine = new RuleBasedPolicyEngine({ rules: [] });

    expect(
      engine.evaluate({
        actionType: "unknown",
        actor: createTestHuman(),
        recipient: createTestActorWithType(ActorType.AGENT),
      }),
    ).toEqual({
      allowed: false,
      approvalRequired: false,
      policyId: "default",
      reason: "No matching policy rule",
    });
  });
});

function createTestActorWithType(type: ActorType) {
  return type === ActorType.AGENT ? createTestAgent() : createTestHuman();
}
