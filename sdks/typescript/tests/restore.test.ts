import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RuleBasedPolicyEngine } from "ocp-policy";
import {
  ActionRequestSchema,
  type ActorRef,
  ApprovalDecidedSchema,
  ApprovalOutcome,
  ApprovalRequestedSchema,
  eventType,
  newEvent,
} from "ocp-protocol";
import { ManualClock, SYSTEM_ACTOR } from "ocp-runtime";
import {
  createTestAgent,
  createTestEvent,
  createTestEventStore,
  createTestHuman,
} from "ocp-testing";
import { describe, expect, it } from "vitest";
import { action, openChannel } from "../src/index.js";

const START = new Date("2030-01-01T00:00:00Z");

interface Harness {
  agent: ReturnType<typeof createTestAgent>;
  app: ReturnType<typeof openChannel>;
  manager: ReturnType<typeof createTestHuman>;
}

/** Builds an app whose agent asks for approval before every reply. Restarts reuse the store and clock. */
function buildApp(
  store: ReturnType<typeof createTestEventStore>,
  clock: ManualClock,
  executed: string[],
  approvalTimeoutMs = 60_000,
  runtimeActor?: ActorRef,
): Harness {
  const agent = createTestAgent("agent:support", "Support Agent");
  const manager = createTestHuman("human:manager", "Support Manager");
  const app = openChannel({
    actions: [
      action({
        execute: (input: { ticketId: string }) => {
          executed.push(input.ticketId);
          return { sent: true };
        },
        type: "send_reply",
        validate: (input) => input as { ticketId: string },
      }),
    ],
    agents: [
      {
        id: agent.id,
        name: agent.displayName,
        onMessage: async (ctx) => {
          await ctx.request(
            "send_reply",
            { ticketId: "ticket:1" },
            { approver: manager, reason: "review" },
          );
        },
      },
    ],
    approvalTimeoutMs,
    clock,
    policy: new RuleBasedPolicyEngine({
      rules: [{ actionType: "send_reply", allowed: true, id: "review", requiresApproval: true }],
    }),
    runtimeActor,
    store,
  });
  return { agent, app, manager };
}

async function approvalId(store: ReturnType<typeof createTestEventStore>): Promise<string> {
  const requested = (await store.all()).find((event) => eventType(event) === "approval.requested");
  if (requested?.payload.case !== "approvalRequested") {
    throw new Error("no approval.requested event was stored");
  }
  return requested.payload.value.approvalId;
}

describe("restart recovery", () => {
  it("resumes an unresolved approval after a restart and runs the action on approval", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];

    const first = buildApp(store, clock, executed);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.stop();
    expect(executed).toEqual([]);

    const second = buildApp(store, clock, executed);
    await second.app.start();
    await second.app.approve(await approvalId(store), second.manager, "approved after restart");
    await second.app.stop();

    expect(executed).toEqual(["ticket:1"]);
  });

  it("expires an approval whose deadline passed while the process was down", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];

    const first = buildApp(store, clock, executed, 1000);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.stop();

    await clock.advanceBy(5000);
    const second = buildApp(store, clock, executed, 1000);
    await second.app.start();
    await clock.advanceBy(0);
    await second.app.stop();

    const types = (await store.all()).map((event) => eventType(event));
    expect(types).toContain("approval.expired");
    expect(executed).toEqual([]);
  });

  it("runs a granted approval whose action never reached a terminal event", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];

    const first = buildApp(store, clock, executed);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.stop();

    // Simulate a crash after the grant was stored but before the action ran.
    await store.append(
      newEvent({
        payload: {
          case: "approvalDecided",
          value: create(ApprovalDecidedSchema, {
            approvalId: await approvalId(store),
            approver: first.manager,
            outcome: ApprovalOutcome.GRANTED,
            reason: "granted before crash",
          }),
        },
        source: SYSTEM_ACTOR,
      }),
    );

    const second = buildApp(store, clock, executed);
    await second.app.start();
    await second.app.stop();

    expect(executed).toEqual(["ticket:1"]);
  });

  it("ignores an approval request that the runtime did not write", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];
    const agent = createTestAgent("agent:support", "Support Agent");
    const forger = createTestHuman("human:forger", "Forger");
    await store.append(
      newEvent({
        payload: {
          case: "approvalRequested",
          value: create(ApprovalRequestedSchema, {
            agent,
            approvalId: "forged-1",
            approver: forger,
            deadline: timestampFromDate(new Date("2099-01-01T00:00:00Z")),
            reason: "forged",
            requestedAction: create(ActionRequestSchema, {
              actionId: "forged-action",
              parameters: { input: JSON.stringify({ ticketId: "forged" }) },
              type: "send_reply",
            }),
          }),
        },
        source: forger,
      }),
    );

    const app = buildApp(store, clock, executed);
    await app.app.start();
    await expect(app.app.approve("forged-1", app.manager, "try")).rejects.toThrow();
    await app.app.stop();

    expect(executed).toEqual([]);
  });

  it("does not let a grant from someone other than the approver resolve the request", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];

    const first = buildApp(store, clock, executed);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.stop();

    const stranger = createTestHuman("human:stranger", "Stranger");
    await store.append(
      newEvent({
        payload: {
          case: "approvalDecided",
          value: create(ApprovalDecidedSchema, {
            approvalId: await approvalId(store),
            approver: stranger,
            outcome: ApprovalOutcome.GRANTED,
            reason: "forged",
          }),
        },
        source: SYSTEM_ACTOR,
      }),
    );

    const second = buildApp(store, clock, executed);
    await second.app.start();
    await second.app.stop();

    expect(executed).toEqual([]);
  });

  it("honours a grant written before decisions were runtime-sourced, from the designated approver", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];

    const first = buildApp(store, clock, executed);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.stop();

    await store.append(
      newEvent({
        payload: {
          case: "approvalDecided",
          value: create(ApprovalDecidedSchema, {
            approvalId: await approvalId(store),
            approver: first.manager,
            outcome: ApprovalOutcome.GRANTED,
            reason: "legacy grant",
          }),
        },
        source: first.manager,
      }),
    );

    const second = buildApp(store, clock, executed);
    await second.app.start();
    await second.app.stop();

    expect(executed).toEqual(["ticket:1"]);
  });

  it("does not re-run an approved action after restart on a store without action records", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];

    const first = buildApp(store, clock, executed);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.approve(await approvalId(store), first.manager, "approved");
    await first.app.stop();
    expect(executed).toEqual(["ticket:1"]);

    // A store with no action-record support: the in-memory fallback is empty after a restart.
    const bare = Object.assign(Object.create(store), {
      claimAction: undefined,
      completeAction: undefined,
      failAction: undefined,
      getAction: undefined,
    }) as typeof store;
    const second = buildApp(bare, clock, executed);
    await second.app.start();
    await second.app.stop();

    expect(executed).toEqual(["ticket:1"]);
  });

  it("does not re-run an approved action when the app uses a custom runtime actor", async () => {
    const store = createTestEventStore();
    const clock = new ManualClock(START);
    const executed: string[] = [];
    const custom = createTestHuman("system:custom-runtime", "Custom Runtime");

    const first = buildApp(store, clock, executed, 60_000, custom);
    await first.app.start();
    await first.app.ingest(createTestEvent({ recipient: first.agent, text: "refund please" }));
    await first.app.approve(await approvalId(store), first.manager, "approved");
    await first.app.stop();
    expect(executed).toEqual(["ticket:1"]);

    const bare = Object.assign(Object.create(store), {
      claimAction: undefined,
      completeAction: undefined,
      failAction: undefined,
      getAction: undefined,
    }) as typeof store;
    const second = buildApp(bare, clock, executed, 60_000, custom);
    await second.app.start();
    await second.app.stop();

    expect(executed).toEqual(["ticket:1"]);
  });
});
