/**
 * Native TypeScript OCP example: an action that requires human approval.
 *
 * OCP concepts demonstrated:
 * - `action()` declares a typed action with `validate` and `execute`.
 * - `RuleBasedPolicyEngine` marks `calendar.create` as `requiresApproval`.
 * - `context.request()` asks OCP to run an action. Policy returns `approval_required`
 *   instead of executing it.
 * - `app.approve()` records the human decision. Only then does the action execute.
 * - `hooks.onActionCompleted` observes the final action result.
 *
 * Working rule: an approval request is not execution. The action runs only after
 * an explicit approval and an executor produces an action result event.
 *
 * No model, provider, or credential is needed. Run it from the repository root:
 *   pnpm exec tsx examples/native-typescript/src/approval-flow.ts
 */
import { create } from "@bufbuild/protobuf";
import {
  type ActionResult,
  ActorRefSchema,
  ActorType,
  action,
  ChannelRefSchema,
  type EventEnvelope,
  eventType,
  messageReceived,
  openChannel,
  RuleBasedPolicyEngine,
} from "@openchannelprotocol/sdk";

import { createDemoEventStore } from "./demo-store.js";

/** Stable identifier of the agent that requests the calendar action. */
const AGENT_ID = "agent:operator";

/** Stable identifier of the human who sends the inbound request. */
const HUMAN_ID = "human:example";

/** Stable identifier of the human who approves the action. Must differ from the requester. */
const APPROVER_ID = "human:approver";

/** Stable identifier of the demo channel the inbound message arrives on. */
const CHANNEL_ID = "channel:example";

/** Action type string referenced by both the action definition and the policy rule. */
const CALENDAR_ACTION_TYPE = "calendar.create";

/** Title of the calendar event the agent asks to create. */
const EVENT_TITLE = "Team sync";

/** Input payload for `calendar.create`. */
interface CalendarInput {
  /** Human-readable title of the calendar event. */
  title: string;
}

const agent = create(ActorRefSchema, { id: AGENT_ID, type: ActorType.AGENT });
const human = create(ActorRefSchema, { id: HUMAN_ID, type: ActorType.HUMAN });
const approver = create(ActorRefSchema, { id: APPROVER_ID, type: ActorType.HUMAN });

/**
 * Demo action `calendar.create`.
 *
 * `validate` rejects malformed input before policy runs. `execute` is where a real
 * calendar provider call would go. Here it returns a string so no side effect happens.
 */
const createCalendarEvent = action<CalendarInput, { created: string }>({
  execute: (input) => ({ created: `calendar event "${input.title}" on calendar:team` }),
  type: CALENDAR_ACTION_TYPE,
  validate: (input) => {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof (input as CalendarInput).title !== "string"
    ) {
      throw new Error(`${CALENDAR_ACTION_TYPE} requires a string title`);
    }
    return { title: (input as CalendarInput).title };
  },
});

/** Completed action results, collected by `hooks.onActionCompleted`. */
const completed: ActionResult<unknown>[] = [];

/** The most recent result of `context.request()`, set by the agent handler. */
let requested: ActionResult<unknown> | undefined;

const app = openChannel({
  actions: [createCalendarEvent],
  agents: [
    {
      description: "Asks to create calendar events; policy decides whether a human must approve",
      id: AGENT_ID,
      name: "Operator",
      /**
       * Requests the calendar action through OCP rather than calling the calendar directly.
       * The reply reports whether the request is waiting for approval.
       */
      onMessage: async (context) => {
        requested = await context.request<CalendarInput, { created: string }>(
          CALENDAR_ACTION_TYPE,
          { title: EVENT_TITLE },
          { reason: "Schedule the approved team meeting", target: "calendar:team" },
        );
        await context.reply(`Requested ${CALENDAR_ACTION_TYPE}: ${requested.status}`);
      },
      skills: [{ id: "schedule", name: "Schedule calendar events" }],
    },
  ],
  approver,
  hooks: {
    onActionCompleted: (result) => {
      completed.push(result);
    },
  },
  policy: new RuleBasedPolicyEngine({
    rules: [
      {
        actionType: CALENDAR_ACTION_TYPE,
        allowed: true,
        id: "calendar-approval",
        reason: "Calendar changes require human approval",
        requiresApproval: true,
      },
    ],
  }),
  store: createDemoEventStore(),
});

await app.start();
await app.ingest(
  messageReceived({
    actor: human,
    channel: create(ChannelRefSchema, { channelId: CHANNEL_ID, provider: "example" }),
    recipient: agent,
    text: "Please schedule the team sync.",
  }),
);

// Stop early with a clear message if the policy did not route the action to approval.
if (requested?.status !== "approval_required") {
  throw new Error(`Expected approval_required, received ${requested?.status ?? "no request"}`);
}

// First print: the approval is pending and the store holds the events recorded so far.
const storedBeforeDecision = await app.store.all();
console.log({
  approvalId: requested.approvalId,
  events: storedBeforeDecision.map((event: EventEnvelope) => eventType(event)),
  status: requested.status,
});

// The human decision. Only this call lets the action execute.
await app.approve(requested.approvalId, approver, "Approved by the example approver");
await app.stop();

// Second print: the action completed, and the store holds the approval and execution events.
const storedAfterDecision = await app.store.all();
console.log({
  completed: completed.map((result) => result.status),
  recorded: storedAfterDecision.map((event) => eventType(event)),
});
