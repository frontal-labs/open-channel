# ocp-sdk/cedar

A Cedar policy engine for OCP. It adapts a Cedar evaluator you provide to the `PolicyEngine`
contract, so every action an agent requests is decided by your Cedar policy set before it runs.

## Where it sits in the OCP flow

```text
agent requests action -> OCP policy context -> Cedar evaluator (this adapter)
  -> allow | deny | approval required -> action runs only on allow
```

Policy is evaluated synchronously, before any side effect. A denied or unanswered decision means the
action never executes.

## Install

```sh
pnpm add ocp-sdk
```

## Quickstart

The adapter does not embed Cedar. Wrap the Cedar engine you use (for example `@cedar-policy/cedar-wasm`)
in an object with an `evaluate` method. The stub below always denies, to show the shape.

```ts
import { cedarPolicy } from "ocp-sdk/cedar";
import { createTestEventStore } from "@openchannel/testing";
import { openChannel } from "ocp-sdk";

const policy = cedarPolicy({
  evaluator: {
    evaluate: (context) => ({
      allowed: false,
      approvalRequired: false,
      policyId: "cedar:default-deny",
      reason: `no permit matched ${context.actionType}`,
    }),
  },
});

const app = openChannel({
  channels: [],
  policy,
  store: createTestEventStore(),
});
```

Replace the stub with a call into your Cedar engine. Map its result to a `PolicyDecision`
(`allowed`, `approvalRequired`, `policyId`, `reason`). The `PolicyContext` passed in has `actionType`,
`actor`, an optional `recipient`, and an optional `target`.

## Decision mapping

- Only a literal `true` grants access. `allowed` and `approvalRequired` are coerced to strict booleans,
  so a malformed evaluator result cannot allow an action.
- `policyId` and `reason` pass through unchanged, so audit records show which Cedar policy decided.
- An exception thrown by the evaluator propagates unchanged. The runtime records no decision, and the
  action does not run.

## Safety boundary

- The host owns the Cedar policy set and schema. Keep them in version control and load them at
  startup.
- The evaluator must not perform network I/O. Cedar evaluation is a local, pure check.
- An approval-required decision pauses the action until a human approves it. Approval alone never
  executes anything; the action still needs its executor and result event.

## Environment

None. Policy files and schemas are passed in code or loaded by your application.

## Tests

```sh
pnpm --filter ocp-sdk test
```

The tests use a fake evaluator and need no Cedar runtime.
