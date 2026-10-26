import type { PolicyContext, PolicyDecision } from "ocp-policy";

/**
 * Synchronous OPA evaluation port used for OCP policy decisions.
 *
 * The transport returns the raw OPA response, which the adapter maps to a PolicyDecision.
 */
export interface OpenchannelTransport {
  /**
   * Evaluates a policy input synchronously.
   *
   * The current OCP PolicyEngine contract is synchronous. A remote OPA client
   * should therefore provide a local cache or a synchronous embedding at this
   * boundary; an async transport can be added when the core contract grows an
   * async policy hook.
   */
  evaluate: (input: PolicyContext) => unknown;
}

/** Options for the OPA-backed policy engine. */
export interface OpenchannelPolicyOptions {
  /**
   * Decision used when the transport returns something other than an object. Defaults to a deny
   * with policy ID `openchannel:default-deny`. Must deny: a default that allows throws `ValidationError`
   * when the engine is constructed.
   */
  defaultDecision?: PolicyDecision;
  /** Synchronous transport that performs the OPA evaluation. Required. */
  transport: OpenchannelTransport;
}
