# ocp-sdk/openchannel

An Open Policy Agent (OPA) decision adapter for OCP. It turns the raw result of an OPA evaluation
into an OCP `PolicyDecision`, so an action only runs when your Rego policy allows it.

## Where it sits in the OCP flow

```text
agent requests action -> OCP policy context -> OPA evaluation (this adapter)
  -> allow | deny | approval required -> action runs only on allow
```

## Install

```sh
pnpm add ocp-sdk
```

## Quickstart

The OCP `PolicyEngine` contract is synchronous, so the transport must return a decision without
awaiting the network. Typical setups evaluate OPA in-process (through a WebAssembly build) or keep a
decision cache that a background job refreshes from an OPA server. The stub below returns a fixed
response to show the shape.

```ts
import { openchannelPolicy } from "ocp-sdk/openchannel";
import { postgresStore } from "ocp-sdk/postgres";
import { openChannel } from "ocp-sdk";

const policy = openchannelPolicy({
  transport: {
    // Return the raw OPA response for this input. Replace with your evaluation.
    evaluate: (input) => ({
      allowed: input.actionType === "calendar.create",
      approvalRequired: false,
      policyId: "openchannel:agent-actions",
      reason: "calendar writes are allowed",
    }),
  },
});

const app = openChannel({
  channels: [],
  policy,
  store: postgresStore({ client: pool }), // pool: your PostgresClient, see POSTGRES.md
});
```

## Response mapping

- Only a literal `allowed: true` grants access. A missing or non-boolean `allowed` denies.
- `approvalRequired: true` pauses the action until a human approves it.
- `policyId` and `reason` are taken from the response when present, so audit records name the Rego rule.
- A response that is not an object returns `defaultDecision`. The default is a deny with policy ID
  `openchannel:default-deny`. `defaultDecision` must deny: the constructor throws a `ValidationError` for an
  allowing default, so a malformed response can never grant access.
- A transport exception is rethrown as a retryable `TransportError` with stage `policy`. No decision is
  recorded, so the action does not run.

## Safety boundary

- Keep Rego policies in version control and test them with `opa test`.
- Your transport selects the Rego package and query. The adapter sends the OCP policy context as-is.
- The transport decides how to reach OPA. The adapter performs no network I/O itself.

## Environment

None in the package. Your transport supplies the OPA endpoint or the local WebAssembly module, plus
any credentials that OPA requires.

## Tests

```sh
pnpm --filter ocp-sdk test
```

The tests use fake transports and need no OPA server.
