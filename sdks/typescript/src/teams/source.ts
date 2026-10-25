import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ChannelSource, ReceiveMetadata } from "ocp-adapter";
import { OpenChannelError, ValidationError } from "ocp-core";
import type { ActorRef, EventEnvelope } from "ocp-protocol";
import {
  ActorRefSchema,
  ActorType,
  ApprovalDecidedSchema,
  ApprovalOutcome,
  ChannelRefSchema,
  ConversationRefSchema,
  ConversationStatus,
  MessageReceivedSchema,
  newEvent,
} from "ocp-protocol";

import { optionalRecord, optionalString, sourceRecord, type TeamsRecord } from "./records.js";
import type { TeamsSourceOptions } from "./types.js";

/**
 * Normalizes one Teams webhook activity into OCP events.
 *
 * An `approve` or `deny` action that carries an approval ID becomes one `approval.decided`
 * event. Any other activity with a sender and conversation becomes one `message.received` event
 * whose text is `text` (or `body`). Activities with no sender or conversation, non-message types,
 * and messages from `botId` produce an empty array, so the caller receives nothing to route.
 *
 * @param input - Parsed JSON body of the Teams activity. Untrusted; not verified here.
 * @param metadata - Event ID, idempotency key, and receive time from the transport, if known.
 * @param options - Actor resolution, bot identity, and the recipient agent.
 * @throws ValidationError when an approval action has no sender.
 */
export async function normalizeTeamsEvent(
  input: unknown,
  metadata: ReceiveMetadata = {},
  options: TeamsSourceOptions = {},
): Promise<EventEnvelope | never[]> {
  const body = sourceRecord(input);
  const action = optionalRecord(body.value) ?? optionalRecord(body.action) ?? {};
  const actionName = optionalString(action, "action") ?? optionalString(action, "verb");
  const approvalId = optionalString(action, "approvalId") ?? optionalString(body, "approvalId");
  if (approvalId && (actionName === "approve" || actionName === "deny")) {
    return await normalizeApprovalDecision(body, action, approvalId, actionName, metadata, options);
  }
  return await normalizeMessage(body, metadata, options);
}

/**
 * Turns an approval-card submission into `approval.decided`. The approver is the Teams user who
 * pressed the button, taken from the activity sender (`from`). Any actor ID inside the card's
 * submitted value is ignored: the card author controls that value, so trusting it would let a
 * card attribute a decision to someone else. A submission without a sender is rejected rather
 * than attributed to an unknown approver.
 */
async function normalizeApprovalDecision(
  body: TeamsRecord,
  action: TeamsRecord,
  approvalId: string,
  actionName: "approve" | "deny",
  metadata: ReceiveMetadata,
  options: TeamsSourceOptions,
): Promise<EventEnvelope> {
  const from = optionalRecord(body.from) ?? {};
  // aadObjectId is the stable Entra identity; `id` is the bot-scoped Teams ID and is the fallback.
  const externalActorId = optionalString(from, "aadObjectId") ?? optionalString(from, "id");
  if (!externalActorId) {
    throw new ValidationError("Microsoft Teams approval action has no sender", {
      provider: "microsoft-teams",
      stage: "normalize",
    });
  }
  const actor = await resolveActor(
    externalActorId,
    optionalString(from, "name") ?? externalActorId,
    options,
  );
  const conversationId = optionalString(body, "conversationId");
  return newEvent({
    actor,
    channel: create(ChannelRefSchema, {
      channelId: conversationId ?? "teams:approval",
      provider: "microsoft-teams",
    }),
    conversation: create(ConversationRefSchema, {
      id: `teams:${conversationId ?? approvalId}`,
      status: ConversationStatus.OPEN,
    }),
    eventId: metadata.eventId ?? optionalString(body, "id") ?? approvalId,
    extensions: { "ocp.provider": "microsoft-teams", "teams.approval_id": approvalId },
    idempotencyKey: metadata.idempotencyKey,
    occurredAt: receivedAt(metadata),
    payload: {
      case: "approvalDecided",
      value: create(ApprovalDecidedSchema, {
        approvalId,
        approver: actor,
        outcome: actionName === "approve" ? ApprovalOutcome.GRANTED : ApprovalOutcome.DENIED,
        reason: optionalString(action, "reason") ?? "Teams approval action",
      }),
    },
    recipient: options.recipient,
    source: actor,
  });
}

/** Turns an ordinary Teams message activity into `message.received`, or an empty array to skip it. */
async function normalizeMessage(
  body: TeamsRecord,
  metadata: ReceiveMetadata,
  options: TeamsSourceOptions,
): Promise<EventEnvelope | never[]> {
  const message = optionalRecord(body.resource) ?? optionalRecord(body.message) ?? body;
  const activityType = optionalString(message, "type");
  if (activityType && activityType !== "message") {
    return [];
  }
  const from = optionalRecord(message.from);
  const user = optionalRecord(from?.user) ?? from ?? {};
  const actorId = optionalString(user, "id") ?? optionalString(message, "fromId");
  const conversation = optionalRecord(message.conversation);
  const conversationId =
    optionalString(conversation ?? {}, "id") ?? optionalString(message, "conversationId");
  if (!(actorId && conversationId) || (options.botId && actorId === options.botId)) {
    return [];
  }
  const actor = await resolveActor(
    actorId,
    optionalString(user, "displayName") ?? actorId,
    options,
  );
  const eventId = metadata.eventId ?? optionalString(body, "id") ?? optionalString(message, "id");

  return newEvent({
    actor,
    channel: create(ChannelRefSchema, {
      channelId: conversationId,
      provider: "microsoft-teams",
      threadId: optionalString(message, "replyToId"),
    }),
    conversation: create(ConversationRefSchema, {
      id: `teams:${conversationId}`,
      participants: [actor],
      status: ConversationStatus.OPEN,
    }),
    eventId,
    extensions: { "ocp.provider": "microsoft-teams" },
    idempotencyKey: metadata.idempotencyKey ?? eventId,
    occurredAt: receivedAt(metadata),
    payload: {
      case: "messageReceived",
      value: create(MessageReceivedSchema, {
        text: optionalString(message, "text") ?? optionalString(message, "body") ?? "",
      }),
    },
    recipient: options.recipient,
    source: actor,
  });
}

/**
 * Creates a Teams source for `openChannel({ channels })`. Errors that are already OCP errors pass
 * through unchanged. Anything else is wrapped as a `ValidationError` at the normalize stage.
 */
export function teamsSource(options: TeamsSourceOptions = {}): ChannelSource {
  return {
    normalize: async (input, metadata) => {
      try {
        return await normalizeTeamsEvent(input, metadata, options);
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new ValidationError("Unable to normalize microsoft-teams input", {
          cause: error,
          provider: "microsoft-teams",
          stage: "normalize",
        });
      }
    },
    provider: "microsoft-teams",
  };
}

/**
 * Resolves a Teams user ID to an OCP actor. Uses `actorResolver` when the host supplies one;
 * otherwise builds a human actor with ID `teams:<userId>`.
 */
function resolveActor(
  userId: string,
  displayName: string,
  options: TeamsSourceOptions,
): ActorRef | Promise<ActorRef> {
  return options.actorResolver
    ? options.actorResolver(userId)
    : humanActor(`teams:${userId}`, displayName);
}

function receivedAt(metadata: ReceiveMetadata) {
  return metadata.receivedAt ? timestampFromDate(metadata.receivedAt) : undefined;
}

function humanActor(id: string, displayName: string): ActorRef {
  return create(ActorRefSchema, {
    authority: "",
    capabilities: [],
    displayName,
    id,
    type: ActorType.HUMAN,
  });
}
