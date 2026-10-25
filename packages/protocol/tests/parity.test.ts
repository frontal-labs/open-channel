import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  ActionExecutedSchema,
  ActionFailedSchema,
  ActionRequestSchema,
  ActorRefSchema,
  ActorType,
  ApprovalDecidedSchema,
  ApprovalExpiredSchema,
  ApprovalOutcome,
  ApprovalRequestedSchema,
  ArtifactRefSchema,
  ChannelRefSchema,
  ConversationRefSchema,
  ConversationStatus,
  EscalationTriggeredSchema,
  type EventPayload,
  type EventType,
  eventType,
  fromBinary,
  HandoffCompletedSchema,
  HandoffInitiatedSchema,
  MessageReceivedSchema,
  MessageSentSchema,
  newEvent,
  PolicyEvaluatedSchema,
  TaskAssignedSchema,
  TaskCreatedSchema,
  toBinary,
} from "../src/index.js";

/**
 * Cross-language parity fixture. Every event kind is encoded as real protobuf. The Python and
 * Rust SDK tests decode these bytes and re-encode them to the same bytes, which proves all three
 * implementations agree on the wire format.
 *
 * Regenerate with: UPDATE_PROTOCOL_FIXTURES=1 pnpm --filter ocp-protocol test
 */
const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/event-parity.json", import.meta.url));

const human = create(ActorRefSchema, {
  authority: "tenant:parity",
  capabilities: ["approve", "reply"],
  displayName: "Parity Human",
  id: "human:parity",
  type: ActorType.HUMAN,
});
const agent = create(ActorRefSchema, {
  displayName: "Parity Agent",
  id: "agent:parity",
  type: ActorType.AGENT,
});
const channel = create(ChannelRefSchema, {
  address: "parity@example.test",
  channelId: "channel:parity",
  provider: "memory",
  threadId: "thread:parity",
});
const conversation = create(ConversationRefSchema, {
  id: "conversation:parity",
  participants: [human, agent],
  status: ConversationStatus.OPEN,
});
const artifact = create(ArtifactRefSchema, {
  id: "artifact:1",
  mediaType: "text/plain",
  sourceOfTruth: "crm",
  title: "Notes",
  uri: "https://example.test/notes",
});
const action = create(ActionRequestSchema, {
  actionId: "action:parity",
  parameters: { input: '{"value":2}' },
  target: "customer:1",
  type: "customer.reply",
});
const deadline = timestampFromDate(new Date("2030-01-01T00:00:00Z"));

const payloads: Record<string, { eventType: EventType; payload: EventPayload }> = {
  actionExecuted: {
    eventType: "action.executed",
    payload: {
      case: "actionExecuted",
      value: create(ActionExecutedSchema, {
        action,
        artifacts: [artifact],
        result: '{"ok":true}',
      }),
    },
  },
  actionFailed: {
    eventType: "action.failed",
    payload: {
      case: "actionFailed",
      value: create(ActionFailedSchema, {
        action,
        errorCode: "PROVIDER_DOWN",
        errorMessage: "provider unavailable",
        retryable: true,
      }),
    },
  },
  approvalDecidedDenied: {
    eventType: "approval.denied",
    payload: {
      case: "approvalDecided",
      value: create(ApprovalDecidedSchema, {
        approvalId: "approval:parity",
        approver: human,
        outcome: ApprovalOutcome.DENIED,
        reason: "not allowed",
      }),
    },
  },
  approvalDecidedGranted: {
    eventType: "approval.granted",
    payload: {
      case: "approvalDecided",
      value: create(ApprovalDecidedSchema, {
        approvalId: "approval:parity",
        approver: human,
        outcome: ApprovalOutcome.GRANTED,
        reason: "approved",
      }),
    },
  },
  approvalExpired: {
    eventType: "approval.expired",
    payload: {
      case: "approvalExpired",
      value: create(ApprovalExpiredSchema, { approvalId: "approval:parity", reason: "timed out" }),
    },
  },
  approvalRequested: {
    eventType: "approval.requested",
    payload: {
      case: "approvalRequested",
      value: create(ApprovalRequestedSchema, {
        agent,
        approvalId: "approval:parity",
        approver: human,
        deadline,
        reason: "refund over limit",
        requestedAction: action,
      }),
    },
  },
  escalationTriggered: {
    eventType: "escalation.triggered",
    payload: {
      case: "escalationTriggered",
      value: create(EscalationTriggeredSchema, {
        escalationId: "escalation:parity",
        reason: "no response",
        relatedApprovalId: "approval:parity",
        source: agent,
        target: human,
      }),
    },
  },
  handoffCompleted: {
    eventType: "handoff.completed",
    payload: {
      case: "handoffCompleted",
      value: create(HandoffCompletedSchema, {
        completedBy: human,
        handoffId: "handoff:parity",
        outcome: "resolved",
      }),
    },
  },
  handoffInitiated: {
    eventType: "handoff.initiated",
    payload: {
      case: "handoffInitiated",
      value: create(HandoffInitiatedSchema, {
        from: agent,
        handoffId: "handoff:parity",
        openQuestions: ["q1", "q2"],
        reason: "needs a person",
        to: human,
      }),
    },
  },
  messageReceived: {
    eventType: "message.received",
    payload: {
      case: "messageReceived",
      value: create(MessageReceivedSchema, {
        attachments: [artifact],
        metadata: { lang: "en", tier: "gold" },
        text: "hello",
      }),
    },
  },
  messageSent: {
    eventType: "message.sent",
    payload: {
      case: "messageSent",
      value: create(MessageSentSchema, { text: "reply" }),
    },
  },
  policyAllowed: {
    eventType: "policy.allowed",
    payload: {
      case: "policyEvaluated",
      value: create(PolicyEvaluatedSchema, {
        actionType: "customer.reply",
        allowed: true,
        approvalRequired: false,
        policyId: "policy:parity",
        reason: "within limit",
        recipient: agent,
      }),
    },
  },
  policyBlocked: {
    eventType: "policy.blocked",
    payload: {
      case: "policyEvaluated",
      value: create(PolicyEvaluatedSchema, {
        actionType: "customer.reply",
        allowed: false,
        approvalRequired: true,
        policyId: "policy:parity",
        reason: "over limit",
        recipient: agent,
      }),
    },
  },
  taskAssigned: {
    eventType: "task.assigned",
    payload: {
      case: "taskAssigned",
      value: create(TaskAssignedSchema, {
        assignee: agent,
        reason: "queue",
        taskId: "task:parity",
      }),
    },
  },
  taskCreated: {
    eventType: "task.created",
    payload: {
      case: "taskCreated",
      value: create(TaskCreatedSchema, {
        description: "Follow up",
        intent: "support",
        requestedBy: human,
        taskId: "task:parity",
      }),
    },
  },
};

interface ParityCase {
  binary: string;
  eventType: EventType;
  name: string;
}

function buildCases(): ParityCase[] {
  return Object.entries(payloads).map(([name, { payload }]) => {
    const event = newEvent({
      actor: human,
      causationId: "cause:parity",
      channel,
      conversation,
      correlationId: "corr:parity",
      eventId: `parity-${name}`,
      extensions: { tenant: "acme", trace: "abc" },
      idempotencyKey: "idem:parity",
      occurredAt: timestampFromDate(new Date("2026-01-01T00:00:00.123Z")),
      payload,
      recipient: agent,
      source: human,
    });
    return {
      binary: Buffer.from(toBinary(event)).toString("base64"),
      eventType: eventType(event),
      name,
    };
  });
}

describe("cross-language protobuf parity", () => {
  const cases = buildCases();

  it("keeps the committed fixture in sync with the TypeScript encoder", () => {
    const serialized = `${JSON.stringify(cases, null, 2)}\n`;
    if (process.env.UPDATE_PROTOCOL_FIXTURES === "1") {
      writeFileSync(FIXTURE_PATH, serialized);
    }
    expect(readFileSync(FIXTURE_PATH, "utf8")).toBe(serialized);
  });

  it.each(cases)("decodes and re-encodes $name to identical bytes", (fixture) => {
    const bytes = Buffer.from(fixture.binary, "base64");
    const event = fromBinary(bytes);

    expect(eventType(event)).toBe(fixture.eventType);
    expect(Buffer.from(toBinary(event)).toString("base64")).toBe(fixture.binary);
  });
});
