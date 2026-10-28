import type { PolicyContext, PolicyDecision, PolicyEngine } from "@openchannelprotocol/policy";

import type { CedarEvaluator, CedarPolicyOptions } from "./types.js";

/**
 * PolicyEngine backed by a host-supplied Cedar evaluator.
 *
 * Only a literal `true` grants access: `allowed` and `approvalRequired` are coerced to strict
 * booleans, so a malformed evaluator result cannot allow an action. An exception thrown by the
 * evaluator propagates unchanged, and the runtime then records no decision for that action.
 */
export class CedarPolicyEngine implements PolicyEngine {
  private readonly evaluator: CedarEvaluator;

  constructor(options: CedarPolicyOptions) {
    this.evaluator = options.evaluator;
  }

  evaluate(context: PolicyContext): PolicyDecision {
    const decision = this.evaluator.evaluate(context);
    return {
      allowed: decision.allowed === true,
      approvalRequired: decision.approvalRequired === true,
      policyId: decision.policyId,
      reason: decision.reason,
    };
  }
}

/** Creates an OCP PolicyEngine backed by a Cedar evaluator. */
export function cedarPolicy(options: CedarPolicyOptions): PolicyEngine {
  return new CedarPolicyEngine(options);
}
