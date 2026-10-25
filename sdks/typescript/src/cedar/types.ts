import type { PolicyContext, PolicyDecision } from "ocp-policy";

/**
 * Synchronous Cedar policy evaluator port; implementations wrap the Cedar engine. The host owns
 * the policy set and schema, and the port must not perform network I/O.
 */
export interface CedarEvaluator {
  /** Returns the decision for one OCP policy context. A thrown error is not turned into a decision. */
  evaluate: (context: PolicyContext) => PolicyDecision;
}

/** Policy engine options that supply a Cedar evaluator. */
export interface CedarPolicyOptions {
  /** Evaluator that decides each action. Required. */
  evaluator: CedarEvaluator;
}
