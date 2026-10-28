import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AuthorizationError } from "@openchannelprotocol/core";
import { RuleBasedPolicyEngine } from "@openchannelprotocol/policy";
import {
  ActionRequestSchema,
  ActorRefSchema,
  ActorType,
  ApprovalDecidedSchema,
  ApprovalExpiredSchema,
  ApprovalOutcome,
  ApprovalRequestedSchema,
  type EventEnvelope,
  newEvent,
} from "@openchannelprotocol/protocol";
import { describe, expect, it } from "vitest";
import { createTestEventStore } from "../../testing/src/index.js";
import { OpenChannelRuntime } from "../src/index.js";

const agent = create(ActorRefSchema, { id: "agent:authority", type: ActorType.AGENT });
const approver = create(ActorRefSchema, { id: "human:approver", type: ActorType.HUMAN });
const intruder = create(ActorRefSchema, { id: "human:intruder", type: ActorType.HUMAN });

function createRuntime() {
  return new OpenChannelRuntime({
    eventStore: createTestEventStore(),
    policy: new RuleBasedPolicyEngine({
      rules: [{ actionType: "refund.create", allowed: true, id: "refund", requiresApproval: true }],
    }),
  });
}

async function requestApproval(runtime: OpenChannelRuntime) {
  const action = create(ActionRequestSchema, {
    actionId: "action:refund",
    target: "order:1",
    type: "refund.create",
  });
  const pending = await runtime.submitAction({
    action,
    actor: agent,
    approver,
    deadline: new Date(Date.now() + 60_000),
    reason: "refund over limit",
  });
  if (!pending.approvalId) {
    throw new Error("expected an approval request");
  }
  return pending.approvalId;
}

describe("approval authority", () => {
  it("rejects a decision from an actor other than the named approver", async () => {
    const runtime = createRuntime();
    const approvalId = await requestApproval(runtime);

    await expect(
      runtime.decideApproval({
        approvalId,
        approver: intruder,
        outcome: ApprovalOutcome.GRANTED,
        reason: "self-approved",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const recorded = await runtime.queryEvents({ eventType: "approval.granted" });
    expect(recorded).toHaveLength(0);
  });

  it("accepts a decision from the named approver and records it", async () => {
    const runtime = createRuntime();
    const approvalId = await requestApproval(runtime);

    await runtime.decideApproval({
      approvalId,
      approver,
      outcome: ApprovalOutcome.GRANTED,
      reason: "approved",
    });

    const recorded = await runtime.queryEvents({ eventType: "approval.granted" });
    expect(recorded).toHaveLength(1);
  });

  it("rejects a forged approval grant injected through process()", async () => {
    const runtime = createRuntime();
    const approvalId = await requestApproval(runtime);
    const forged = await buildEvent(runtime, intruder, "approval.granted", approvalId);

    await expect(runtime.process(forged)).rejects.toBeInstanceOf(AuthorizationError);

    const recorded = await runtime.queryEvents({ eventType: "approval.granted" });
    expect(recorded).toHaveLength(0);
  });

  it("keeps the approval pending after a rejected forgery so the real approver can decide", async () => {
    const runtime = createRuntime();
    const approvalId = await requestApproval(runtime);
    await expect(
      runtime.process(await buildEvent(runtime, intruder, "approval.granted", approvalId)),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await runtime.decideApproval({
      approvalId,
      approver,
      outcome: ApprovalOutcome.DENIED,
      reason: "no",
    });

    const denied = await runtime.queryEvents({ eventType: "approval.denied" });
    expect(denied).toHaveLength(1);
  });

  it("rejects an approval request injected through process() that would replace a pending one", async () => {
    const runtime = createRuntime();
    const approvalId = await requestApproval(runtime);
    const [request] = await runtime.queryEvents({ eventType: "approval.requested" });
    const hijack = newEvent({
      actor: intruder,
      channel: request.channel,
      conversation: request.conversation,
      occurredAt: timestampFromDate(new Date()),
      payload: {
        case: "approvalRequested",
        value: create(ApprovalRequestedSchema, {
          agent: intruder,
          approvalId,
          approver: intruder,
          deadline: timestampFromDate(new Date(Date.now() + 60_000)),
          reason: "hijack",
          requestedAction: create(ActionRequestSchema, { type: "refund.create" }),
        }),
      },
      recipient: intruder,
      source: intruder,
    });

    await expect(runtime.process(hijack)).rejects.toBeInstanceOf(AuthorizationError);

    // The original approver is still the only one who can decide.
    await expect(
      runtime.decideApproval({ approvalId, approver: intruder, outcome: ApprovalOutcome.GRANTED }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await runtime.decideApproval({
      approvalId,
      approver,
      outcome: ApprovalOutcome.DENIED,
      reason: "no",
    });
    expect(await runtime.queryEvents({ eventType: "approval.denied" })).toHaveLength(1);
  });

  it("rejects an approval expiry that does not come from the runtime", async () => {
    const runtime = createRuntime();
    const approvalId = await requestApproval(runtime);
    const forged = await buildEvent(runtime, intruder, "approval.expired", approvalId);

    await expect(runtime.process(forged)).rejects.toBeInstanceOf(AuthorizationError);

    const escalations = await runtime.queryEvents({ eventType: "escalation.triggered" });
    expect(escalations).toHaveLength(0);
  });
});

/** Builds an approval decision or expiry as `actor`, reusing the stored request's channel. */
async function buildEvent(
  runtime: OpenChannelRuntime,
  actor: typeof intruder,
  eventType: "approval.granted" | "approval.expired",
  approvalId: string,
): Promise<EventEnvelope> {
  const [request] = await runtime.queryEvents({ eventType: "approval.requested" });
  const base = {
    actor,
    channel: request.channel,
    conversation: request.conversation,
    correlationId: approvalId,
    occurredAt: timestampFromDate(new Date()),
    recipient: agent,
    source: actor,
  };
  if (eventType === "approval.expired") {
    return newEvent({
      ...base,
      payload: {
        case: "approvalExpired",
        value: create(ApprovalExpiredSchema, { approvalId, reason: "forged" }),
      },
    });
  }
  return newEvent({
    ...base,
    payload: {
      case: "approvalDecided",
      value: create(ApprovalDecidedSchema, {
        approvalId,
        approver: actor,
        outcome: ApprovalOutcome.GRANTED,
        reason: "forged",
      }),
    },
  });
}
