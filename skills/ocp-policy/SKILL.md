---
name: ocp-policy
description: Implement OCP policy decisions, approval lifecycles, escalations, and runtime safety behavior without bypassing authorization.
---

# OCP policy and approvals

Use this skill for changes to authorization, approval routing, deadline
handling, escalation, or the runtime action lifecycle. Read
[`docs/SPEC.md`](../../docs/SPEC.md) before changing semantics.

## Ownership boundaries

- [`packages/policy`](../../packages/policy) defines the provider-neutral
  `PolicyEngine` contract and the reference `RuleBasedPolicyEngine`.
- [`packages/runtime`](../../packages/runtime) evaluates policy, records
  events, tracks pending approvals, and emits expiry/escalation events.
- [`packages/adapter`](../../packages/adapter) is responsible for provider
  delivery, not authorization.
- Shared failure types come from [`ocp-core`](../../packages/core), including
  `ValidationError`, `ProtocolError`, `ConflictError`, `NotFoundError`, and
  `TransportError`.

## Safety invariants

1. Evaluate policy before authorizing an action.
2. A denied action returns a blocked result and must not create an approval or
   execute a side effect.
3. An allowed action with `approvalRequired` creates `approval.requested`; it
   does not execute the requested action.
4. Approval decisions are explicit. `decideApproval()` emits a granted or
   denied event and resolves the pending request, but a grant is not an action
   execution.
5. An expired pending approval emits `approval.expired`, then
   `escalation.triggered`, addressed to the configured approver/escalation
   target.
6. Duplicate event IDs are idempotent and must not repeat state transitions or
   emitted events.
7. Invalid resource state should fail with a shared OCP error rather than a
   provider-specific or ad hoc error.

## Implementation guidance

Use `RuleBasedPolicyEngine` for reference behavior: rules are ordered and the
first matching action/recipient rule wins; the configured default applies when
none matches. Preserve `policyId`, `reason`, and `approvalRequired` in the
decision so callers can explain the outcome.

Keep approval tracking on the runtime’s event path. If adding an event or
state transition, update the protobuf mapping, runtime processing, event
store behavior, and audit tests together. Do not hide policy decisions in an
agent callback or adapter.

## Deterministic verification

Use `ManualClock` to advance approval deadlines without sleeping. Assert the
event sequence and status, not private maps or timer implementation details.
Use `ocp-testing` fixtures and selectors to inspect events. Cover at least:

- deny: `policy.blocked`, no approval;
- allow without approval: `policy.allowed`, authorized result;
- allow with approval: `policy.allowed` then `approval.requested`;
- explicit grant/deny and repeated decision conflict;
- deadline expiry followed by escalation;
- duplicate event processing.
