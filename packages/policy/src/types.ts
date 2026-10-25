import type { ActorRef, ActorType } from "ocp-protocol";

/** Inputs used by a policy engine to authorize an action. */
export interface PolicyContext {
  actionType: string;
  actor: ActorRef;
  recipient?: ActorRef;
  target?: string;
}

/** An ordered policy rule evaluated by the reference policy engine. */
export interface PolicyRule {
  actionType: string;
  allowed: boolean;
  id: string;
  reason?: string;
  recipientId?: string;
  recipientType?: ActorType;
  requiresApproval?: boolean;
}

/** The normalized result of policy evaluation. */
export interface PolicyDecision {
  allowed: boolean;
  approvalRequired: boolean;
  policyId: string;
  reason: string;
}

/** Provider-neutral policy evaluation contract. */
export interface PolicyEngine {
  evaluate: (context: PolicyContext) => PolicyDecision;
}

/** Configuration for the first-match rule-based policy engine. */
export interface RuleBasedPolicyOptions {
  defaultAllowed?: boolean;
  defaultReason?: string;
  rules: PolicyRule[];
}
