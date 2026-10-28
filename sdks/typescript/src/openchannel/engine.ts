import { TransportError, ValidationError } from "@openchannelprotocol/core";
import type { PolicyContext, PolicyDecision, PolicyEngine } from "@openchannelprotocol/policy";

import type { OpenchannelPolicyOptions, OpenchannelTransport } from "./types.js";

/** Default decision: deny, used when no `defaultDecision` is configured. */
const DEFAULT_DENY: PolicyDecision = {
  allowed: false,
  approvalRequired: false,
  policyId: "openchannel:default-deny",
  reason: "OPA did not return an allow decision",
};

/**
 * Maps a raw OPA response to a PolicyDecision. Only a literal `true` grants access, and a missing
 * `allowed` denies. A response that is not an object returns `fallback`, which is always a deny
 * because the constructor rejects an allowing default.
 */
function toDecision(response: unknown, fallback: PolicyDecision): PolicyDecision {
  if (response === null || typeof response !== "object") {
    return fallback;
  }
  const record = response as Record<string, unknown>;
  return {
    allowed: record.allowed === true,
    approvalRequired: record.approvalRequired === true,
    policyId: typeof record.policyId === "string" ? record.policyId : fallback.policyId,
    reason: typeof record.reason === "string" ? record.reason : fallback.reason,
  };
}

/**
 * PolicyEngine backed by a host-supplied OPA transport.
 *
 * A transport exception is rethrown as a retryable `TransportError` with stage `policy`. No
 * decision is returned in that case, so the runtime does not execute the action.
 */
export class OpenchannelPolicyEngine implements PolicyEngine {
  private readonly fallback: PolicyDecision;
  private readonly transport: OpenchannelTransport;

  /**
   * @throws ValidationError when `defaultDecision` allows. A fail-open default would let any
   * malformed OPA response grant access, so the adapter refuses to start with one.
   */
  constructor(options: OpenchannelPolicyOptions) {
    this.transport = options.transport;
    this.fallback = options.defaultDecision ?? DEFAULT_DENY;
    if (this.fallback.allowed) {
      throw new ValidationError(
        "OPA defaultDecision must deny; fail-open defaults are not supported",
        {
          provider: "openchannel",
          stage: "validation",
        },
      );
    }
  }

  evaluate(context: PolicyContext): PolicyDecision {
    let response: unknown;
    try {
      response = this.transport.evaluate(context);
    } catch (error) {
      throw new TransportError("OPA policy evaluation failed", {
        cause: error,
        provider: "openchannel",
        retryable: true,
        stage: "policy",
      });
    }
    return toDecision(response, this.fallback);
  }
}

/** Creates a PolicyEngine for a synchronous OPA transport. */
export function openchannelPolicy(options: OpenchannelPolicyOptions): PolicyEngine {
  return new OpenchannelPolicyEngine(options);
}
