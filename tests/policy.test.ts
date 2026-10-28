import { RuleBasedPolicyEngine } from "@openchannelprotocol/policy";
import { ActorType } from "@openchannelprotocol/protocol";
import { createTestAgent, createTestHuman } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";

describe("OCP policy engine", () => {
  it("matches action, recipient, and recipient type", () => {
    const manager = createTestHuman("human:manager", "Manager", "manager");
    const engine = new RuleBasedPolicyEngine({
      rules: [
        {
          actionType: "send_customer_reply",
          allowed: true,
          id: "manager-review",
          recipientId: manager.id,
          recipientType: ActorType.HUMAN,
          requiresApproval: true,
        },
      ],
    });

    expect(
      engine.evaluate({
        actionType: "send_customer_reply",
        actor: createTestAgent(),
        recipient: manager,
      }),
    ).toEqual({
      allowed: true,
      approvalRequired: true,
      policyId: "manager-review",
      reason: "Matched allow rule",
    });
  });

  it("uses the configured default decision when no rule matches", () => {
    const engine = new RuleBasedPolicyEngine({
      defaultAllowed: true,
      defaultReason: "Safe by default",
      rules: [],
    });

    expect(engine.evaluate({ actionType: "internal.note", actor: createTestAgent() })).toEqual({
      allowed: true,
      approvalRequired: false,
      policyId: "default",
      reason: "Safe by default",
    });
  });
});
