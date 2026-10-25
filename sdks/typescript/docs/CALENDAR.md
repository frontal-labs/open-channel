# ocp-sdk/calendar

Policy-controlled calendar actions for OCP agents. The package turns a calendar backend (Google
Calendar, Microsoft Graph, or CalDAV) into three SDK actions: `calendar.create`,
`calendar.update`, and `calendar.cancel`. An agent asks for one with `ctx.request(...)`. The SDK
validates the input, asks the policy engine for a decision, and only then calls this package's
`execute`. Provider calls are side effects, so they happen only after an allow decision (and any
required approval).

In the OCP flow, the agent harness emits an action request, the runtime evaluates policy, and this
extension is the executor that performs the calendar write and returns an action result event.

## Install

```sh
pnpm add ocp-sdk
```

`@openchannel/core` is pulled in as a dependency. `@openchannel/policy`
is needed for the reference `RuleBasedPolicyEngine` used below; any `PolicyEngine` works.

## Quickstart

```ts
import { calendarActions, type CalendarClient } from "ocp-sdk/calendar";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { openChannel, type OpenChannelOptions } from "ocp-sdk";

// Injected by the application: a client that wraps your calendar SDK and holds its credentials.
declare const calendarClient: CalendarClient;
// Injected by the application: a durable event store (for example from the postgres extension).
declare const store: OpenChannelOptions["store"];

const app = openChannel({
  actions: calendarActions(calendarClient),
  agents: [
    {
      id: "agent:scheduler",
      name: "Scheduler",
      onMessage: async (ctx) => {
        await ctx.request("calendar.create", {
          end: "2026-10-23T11:00:00Z",
          start: "2026-10-23T10:00:00Z",
          title: "Design review",
        });
      },
    },
  ],
  policy: new RuleBasedPolicyEngine({
    rules: [
      {
        actionType: "calendar.create",
        allowed: true,
        id: "calendar-create-needs-approval",
        requiresApproval: true,
      },
    ],
  }),
  store,
});

await app.start();
```

Action types with no matching rule are denied, because `RuleBasedPolicyEngine` defaults to deny.

## Actions

| Type               | Input                                         | Client method              |
| ------------------ | --------------------------------------------- | -------------------------- |
| `calendar.create`  | `title`, `start`, `end`, optional fields      | `create(input)`            |
| `calendar.update`  | `eventId` plus any subset of create fields    | `update(input)`            |
| `calendar.cancel`  | `eventId`, optional `reason`                  | `cancel(input)`            |

Inputs are parsed with Zod before policy runs. Unknown keys are dropped, empty strings are rejected,
and a malformed request fails as a failed action without reaching the policy engine or the client.

## Safety and policy boundary

- Validation happens first. A rejected input never reaches policy or the calendar backend. Create
  requires `end` to be later than `start`, and an update is checked the same way whenever both are
  present.
- Policy decides by action type (`calendar.create`, and so on). Use `requiresApproval` for writes
  that a person should confirm. An approval request is not execution: the action runs only after
  approval, and the result is recorded as an action event.
- The package performs no side effect on its own. Creating a client, reading credentials, and
  choosing which calendar to write to are the caller's decisions.
- Errors thrown by the client are wrapped as retryable `ActionError`s with `provider: "calendar"`,
  unless the client already threw an `ActionError`, which passes through unchanged.
- Date strings are not parsed here. Use the format your backend expects (ISO 8601 is the usual choice).

## Environment and secrets

This package reads no environment variables and stores no secrets. The `CalendarClient` you inject
owns OAuth tokens, service-account keys, or CalDAV passwords. Load them from your secret store or
environment in application code, and keep them out of tracked files.

## Tests

```sh
pnpm --filter ocp-sdk test
```
