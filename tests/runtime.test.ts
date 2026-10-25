import { RuleBasedPolicyEngine } from "ocp-policy";
import { ApprovalOutcome, eventType } from "ocp-protocol";
import { ManualClock, OpenChannelRuntime } from "ocp-runtime";
import {
  createTestAction,
  createTestAgent,
  createTestEvent,
  createTestEventStore,
  createTestHuman,
} from "ocp-testing";
import { describe, expect, it } from "vitest";

function createRuntime() {
  const clock = new ManualClock(new Date("2026-10-19T14:00:00.000Z"));
  const agent = createTestAgent("agent:support", "Support Agent");
  const manager = createTestHuman("human:manager", "Support Manager", "manager");
  const runtime = new OpenChannelRuntime({
    clock,
    defaultApprovalTimeoutMs: 1000,
    eventStore: createTestEventStore(),
    policy: new RuleBasedPolicyEngine({
      rules: [
        {
          actionType: "send_customer_reply",
          allowed: true,
          id: "reply-review",
          requiresApproval: true,
        },
      ],
    }),
  });
  return { agent, clock, manager, runtime };
}

describe("OCP runtime", () => {
  it("expires an approval and emits an escalation", async () => {
    const { clock, runtime, agent, manager } = createRuntime();
    const result = await runtime.submitAction({
      action: createTestAction("send_customer_reply", "reply-99", "ticket:99"),
      actor: agent,
      approver: manager,
      reason: "Needs review",
    });

    expect(result.status).toBe("approval_required");
    await clock.advanceBy(1000);

    const events = await runtime.eventStore.all();
    expect(events.map((event) => eventType(event))).toEqual([
      "policy.allowed",
      "approval.requested",
      "approval.expired",
      "escalation.triggered",
    ]);
  });

  it("cancels escalation when approval is granted", async () => {
    const { clock, runtime, agent, manager } = createRuntime();
    const result = await runtime.submitAction({
      action: createTestAction("send_customer_reply", "reply-100", "ticket:100"),
      actor: agent,
      approver: manager,
      reason: "Needs review",
    });

    const { approvalId } = result;
    expect(approvalId).toBeDefined();
    await runtime.decideApproval({
      approvalId: approvalId ?? "",
      approver: manager,
      outcome: ApprovalOutcome.GRANTED,
    });
    await clock.advanceBy(1000);

    const events = await runtime.eventStore.all();
    expect(events.map((event) => eventType(event))).not.toContain("escalation.triggered");
  });

  it("deduplicates an inbound event by event id", async () => {
    const { runtime, agent } = createRuntime();
    const event = createTestEvent({ actor: agent, eventId: "inbound-1", text: "hello" });

    const first = await runtime.process(event);
    const second = await runtime.process(event);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect((await runtime.eventStore.all()).length).toBe(1);
  });
});
