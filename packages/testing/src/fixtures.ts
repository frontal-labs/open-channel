import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type {
  ActionRequest,
  ActorRef,
  EventEnvelope,
  EventInput,
  EventPayload,
  EventType,
} from "@openchannelprotocol/protocol";
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
  HandoffCompletedSchema,
  HandoffInitiatedSchema,
  MessageReceivedSchema,
  MessageSentSchema,
  newEvent,
  PolicyEvaluatedSchema,
  TaskAssignedSchema,
  TaskCreatedSchema,
} from "@openchannelprotocol/protocol";

/** Creates a deterministic human fixture for OCP tests. */
export function createTestHuman(
  id = "human:test",
  displayName = "Test Human",
  authority = "member",
): ActorRef {
  return createTestActor(id, ActorType.HUMAN, displayName, [], authority);
}

/** Creates a deterministic agent fixture for OCP tests. */
export function createTestAgent(
  id = "agent:test",
  displayName = "Test Agent",
  capabilities: string[] = ["test.respond"],
): ActorRef {
  return createTestActor(id, ActorType.AGENT, displayName, capabilities, "agent");
}

/** Creates an OCP actor fixture with explicit identity and capabilities. */
export function createTestActor(
  id: string,
  type: ActorType,
  displayName: string,
  capabilities: string[] = [],
  authority = "",
): ActorRef {
  return create(ActorRefSchema, { authority, capabilities, displayName, id, type });
}

/** Creates a channel reference pointing at the in-memory provider. */
export function createTestChannel(
  channelId = "channel:test",
  threadId = "thread:test",
  provider = "test",
): EventEnvelope["channel"] {
  return create(ChannelRefSchema, { channelId, provider, threadId });
}

/** Creates a conversation reference containing the supplied participants. */
export function createTestConversation(
  id = "conversation:test",
  participants: ActorRef[] = [createTestHuman(), createTestAgent()],
): EventEnvelope["conversation"] {
  return create(ConversationRefSchema, {
    id,
    participants,
    status: ConversationStatus.OPEN,
  });
}

/** Creates a valid action request fixture. */
export function createTestAction(
  type = "test.action",
  actionId = "action:test",
  target = "resource:test",
): ActionRequest {
  return create(ActionRequestSchema, {
    actionId,
    parameters: { fixture: "true" },
    target,
    type,
  });
}

/** Creates a valid message payload fixture. */
export function createTestMessage(
  text = "Test message",
): ReturnType<typeof createTestMessageReceived> {
  return createTestMessageReceived(text);
}

/** Creates a message.received payload fixture. */
export function createTestMessageReceived(text = "Test message") {
  return create(MessageReceivedSchema, { text });
}

/** Creates a message.sent payload fixture. */
export function createTestMessageSent(text = "Test response") {
  return create(MessageSentSchema, { text });
}

/** Options shared by the OCP event fixtures. */
export interface TestEventOptions extends Partial<Omit<EventInput, "payload">> {
  /** Selects the default payload for this event type. */
  eventType?: EventType;
  payload?: EventPayload;
  text?: string;
}

/** Creates a valid OCP event with predictable test defaults. */
export function createTestEvent(options: TestEventOptions = {}): EventEnvelope {
  const {
    eventType = "message.received",
    payload,
    text = "Test message",
    ...eventOptions
  } = options;
  const actor = eventOptions.actor ?? createTestHuman();

  return newEvent({
    ...eventOptions,
    actor,
    channel: eventOptions.channel ?? createTestChannel(),
    conversation: eventOptions.conversation ?? createTestConversation(),
    payload: payload ?? createTestPayload(eventType, actor, text),
    source: eventOptions.source ?? actor,
  });
}

function createTestPayload(eventType: EventType, actor: ActorRef, text: string): EventPayload {
  const agent = actor.type === ActorType.AGENT ? actor : createTestAgent();
  const approver = createTestHuman("human:approver", "Test Approver", "approver");
  const action = createTestAction();
  const deadline = timestampFromDate(new Date("2026-10-20T00:00:00.000Z"));

  switch (eventType) {
    case "action.executed":
      return {
        case: "actionExecuted",
        value: create(ActionExecutedSchema, { action, result: "ok" }),
      };
    case "action.failed":
      return {
        case: "actionFailed",
        value: create(ActionFailedSchema, {
          action,
          errorCode: "TEST_FAILURE",
          errorMessage: "Test action failed",
          retryable: false,
        }),
      };
    case "approval.denied":
    case "approval.granted":
      return {
        case: "approvalDecided",
        value: create(ApprovalDecidedSchema, {
          approvalId: "approval:test",
          approver,
          outcome:
            eventType === "approval.granted" ? ApprovalOutcome.GRANTED : ApprovalOutcome.DENIED,
          reason: "Test decision",
        }),
      };
    case "approval.expired":
      return {
        case: "approvalExpired",
        value: create(ApprovalExpiredSchema, {
          approvalId: "approval:test",
          reason: "Test expiry",
        }),
      };
    case "approval.requested":
      return {
        case: "approvalRequested",
        value: create(ApprovalRequestedSchema, {
          agent,
          approvalId: "approval:test",
          approver,
          deadline,
          reason: "Test approval",
          requestedAction: action,
        }),
      };
    case "escalation.triggered":
      return {
        case: "escalationTriggered",
        value: create(EscalationTriggeredSchema, {
          escalationId: "escalation:test",
          reason: "Test escalation",
          relatedApprovalId: "approval:test",
          source: agent,
          target: approver,
        }),
      };
    case "handoff.completed":
      return {
        case: "handoffCompleted",
        value: create(HandoffCompletedSchema, {
          completedBy: approver,
          handoffId: "handoff:test",
          outcome: "Test handoff completed",
        }),
      };
    case "handoff.initiated":
      return {
        case: "handoffInitiated",
        value: create(HandoffInitiatedSchema, {
          from: agent,
          handoffId: "handoff:test",
          openQuestions: ["What should happen next?"],
          reason: "Test handoff",
          to: approver,
        }),
      };
    case "message.received":
      return { case: "messageReceived", value: createTestMessageReceived(text) };
    case "message.sent":
      return { case: "messageSent", value: createTestMessageSent(text) };
    case "policy.allowed":
    case "policy.blocked":
      return {
        case: "policyEvaluated",
        value: create(PolicyEvaluatedSchema, {
          actionType: action.type,
          allowed: eventType === "policy.allowed",
          approvalRequired: false,
          policyId: "policy:test",
          reason: "Test policy decision",
          recipient: approver,
        }),
      };
    case "task.assigned":
      return {
        case: "taskAssigned",
        value: create(TaskAssignedSchema, {
          assignee: agent,
          reason: "Test assignment",
          taskId: "task:test",
        }),
      };
    case "task.created":
      return {
        case: "taskCreated",
        value: create(TaskCreatedSchema, {
          description: "Test task",
          intent: "test",
          requestedBy: actor,
          taskId: "task:test",
        }),
      };
    default:
      throw new Error(`Unsupported OCP test event type: ${eventType}`);
  }
}

/** Creates a small artifact fixture for tests that need references. */
export function createTestArtifact(id = "artifact:test") {
  return create(ArtifactRefSchema, {
    id,
    mediaType: "text/plain",
    sourceOfTruth: "test",
    title: "Test artifact",
    uri: `ocp://test/${id}`,
  });
}
