# Native TypeScript OCP example

The smallest complete TypeScript OCP app. It uses the public `openChannel()`
API with a rule-based policy, a demo channel, and an in-memory event store.
It runs deterministically and needs no model, provider, or credential.

## Prerequisites

- Node.js 20 or later and pnpm, as used across the repository.
- Dependencies installed from the repository root: `pnpm install`.

## Run

From the repository root, one command per example:

```bash
pnpm exec tsx examples/native-typescript/src/main.ts          # agent replies to one message
pnpm exec tsx examples/native-typescript/src/approval-flow.ts # action waits for human approval
```

Both commands exit with status 0 and print the output shown below.

## Environment variables

None. Both examples are fully deterministic.

## Files

| File | Purpose |
| --- | --- |
| `src/main.ts` | Builds the app, routes one `message.received` to the agent, prints the `message.sent` reply. |
| `src/approval-flow.ts` | Registers `calendar.create` behind an approval rule, requests it, approves it, prints the result. |
| `src/demo-store.ts` | In-memory `EventStore`. Demo only, and it loses state on restart. |

## Expected output

`src/main.ts` prints the agent card and the reply. The `correlationId` changes on each run:

```json
{
  "agentCard": {
    "capabilities": {},
    "description": "Deterministic agent for the native TypeScript example",
    "id": "agent:native-typescript",
    "name": "Native TypeScript Agent",
    "skills": [{ "id": "respond", "name": "Respond to an OCP message" }]
  },
  "correlationId": "<uuid>",
  "eventType": "message.sent",
  "reply": "Deterministic response to: Explain why OCP keeps policy outside the model prompt."
}
```

`src/approval-flow.ts` prints two objects. The `approvalId` changes on each run:

```text
{
  approvalId: 'action:<uuid>:<timestamp>',
  events: [ 'message.received', 'policy.allowed', 'approval.requested', 'message.sent' ],
  status: 'approval_required'
}
{
  completed: [ 'executed' ],
  recorded: [
    'message.received',
    'policy.allowed',
    'approval.requested',
    'message.sent',
    'approval.granted',
    'action.executed'
  ]
}
```

## How this maps to OCP

| Concept | Where it appears |
| --- | --- |
| App composition (agents, channels, policy, store) | `openChannel({...})` in both `src/*.ts` files |
| Inbound event | `messageReceived({...})` creates a `message.received` envelope |
| Agent identity and skills | The `agents[]` entry and `app.agentCards()` |
| Outbound reply | `context.reply(...)` produces a `message.sent` event delivered by the channel sink |
| Policy decision | `RuleBasedPolicyEngine` rules. No rules in `main.ts`. `calendar-approval` in `approval-flow.ts` |
| Typed action | `action({ type, validate, execute })` in `approval-flow.ts` |
| Approval gate | `context.request(...)` returns `approval_required`. `app.approve(...)` is the human decision |
| Action result | `hooks.onActionCompleted` and the `action.executed` event |

## Working rules this example demonstrates

- The model or harness never decides whether an action is authorized. Policy does.
- An approval request is not execution. The action runs only after an explicit
  approval and an executor result.
- The bridge to a model framework receives plain text plus OCP context and returns plain text.

## Next steps

- Replace `createDemoEventStore()` with a durable store such as
  `@openchannelprotocol/sdk/postgres` before any real deployment.
- For a real channel, see [`slack-typescript`](../slack-typescript/README.md).
