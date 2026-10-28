import { TransportError, ValidationError } from "@openchannelprotocol/core";
import { describe, expect, it } from "vitest";
import { openchannelPolicy } from "../../src/openchannel/index.js";

const context = { actionType: "test", actor: {} as never };

describe("@openchannelprotocol/sdk/openchannel", () => {
  it("maps a local OPA decision into PolicyEngine", () => {
    const engine = openchannelPolicy({
      transport: { evaluate: () => ({ allowed: true, policyId: "openchannel:test" }) },
    });
    expect(engine.evaluate(context)).toMatchObject({
      allowed: true,
      policyId: "openchannel:test",
    });
  });

  it("denies by default when the response is not an object", () => {
    const engine = openchannelPolicy({ transport: { evaluate: () => undefined } });
    expect(engine.evaluate(context)).toEqual({
      allowed: false,
      approvalRequired: false,
      policyId: "openchannel:default-deny",
      reason: "OPA did not return an allow decision",
    });
  });

  it("denies when allowed is missing or not a literal true", () => {
    const engine = openchannelPolicy({
      transport: { evaluate: () => ({ allowed: "true", approvalRequired: "yes" }) },
    });
    expect(engine.evaluate(context)).toMatchObject({ allowed: false, approvalRequired: false });
  });

  it("uses the configured defaultDecision for non-object responses", () => {
    const fallback = {
      allowed: false,
      approvalRequired: true,
      policyId: "openchannel:manual-review",
      reason: "no decision",
    };
    const engine = openchannelPolicy({
      defaultDecision: fallback,
      transport: { evaluate: () => null },
    });
    expect(engine.evaluate(context)).toEqual(fallback);
  });

  it("refuses to start with an allowing defaultDecision", () => {
    expect(() =>
      openchannelPolicy({
        defaultDecision: { allowed: true, approvalRequired: false, policyId: "x", reason: "open" },
        transport: { evaluate: () => null },
      }),
    ).toThrow(ValidationError);
  });

  it("wraps transport failures in a retryable policy TransportError", () => {
    const cause = new Error("connection refused");
    const engine = openchannelPolicy({
      transport: {
        evaluate: () => {
          throw cause;
        },
      },
    });
    let caught: unknown;
    try {
      engine.evaluate(context);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TransportError);
    expect(caught).toMatchObject({
      cause,
      provider: "openchannel",
      retryable: true,
      stage: "policy",
    });
  });
});
