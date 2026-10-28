import { describe, expect, it } from "vitest";
import { cedarPolicy } from "../../src/cedar/index.js";

describe("@openchannelprotocol/sdk/cedar", () => {
  it("adapts a Cedar decision to PolicyEngine", () => {
    const engine = cedarPolicy({
      evaluator: {
        evaluate: () => ({
          allowed: true,
          approvalRequired: true,
          policyId: "cedar",
          reason: "review",
        }),
      },
    });
    expect(engine.evaluate({ actionType: "test", actor: {} as never })).toMatchObject({
      allowed: true,
      approvalRequired: true,
    });
  });

  it("grants access only for a literal true", () => {
    const engine = cedarPolicy({
      evaluator: {
        evaluate: () =>
          ({
            allowed: "yes",
            approvalRequired: 1,
            policyId: "cedar",
            reason: "malformed",
          }) as never,
      },
    });
    expect(engine.evaluate({ actionType: "test", actor: {} as never })).toEqual({
      allowed: false,
      approvalRequired: false,
      policyId: "cedar",
      reason: "malformed",
    });
  });

  it("propagates evaluator failures instead of returning a decision", () => {
    const engine = cedarPolicy({
      evaluator: {
        evaluate: () => {
          throw new Error("policy set unavailable");
        },
      },
    });
    expect(() => engine.evaluate({ actionType: "test", actor: {} as never })).toThrow(
      "policy set unavailable",
    );
  });
});
