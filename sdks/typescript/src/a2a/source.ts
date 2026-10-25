import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ChannelSource, ReceiveMetadata } from "ocp-adapter";
import { OpenChannelError, ValidationError } from "ocp-core";
import type { ActorRef } from "ocp-protocol";
import {
  ActorRefSchema,
  ActorType,
  ChannelRefSchema,
  ConversationRefSchema,
  ConversationStatus,
  MessageReceivedSchema,
  newEvent,
} from "ocp-protocol";

import { optionalRecord, optionalString, sourceRecord } from "./records.js";
import type { A2ASourceOptions } from "./types.js";

/** Sender id used when an inbound payload names no sender. */
const UNKNOWN_SENDER = "remote-agent";
/** Context id used when an inbound payload names no context, so such messages share one conversation. */
const UNKNOWN_CONTEXT = "remote-context";

/**
 * Normalizes an A2A-style inbound payload into an OCP `message.received` event.
 *
 * Accepts either a bare message or an envelope with a `message` field, and reads text from
 * `message.parts[].text` (joined with newlines) or a top-level `message.text`. A message from
 * `options.localAgentId` resolves to `[]`, which is how a host avoids answering its own echo.
 * Without a sender, the sender is `remote-agent`. Any other sender is not checked and is trusted.
 * The source is a pure synchronous-shaped transform: it does not call the network.
 */
export function normalizeA2AEvent(
  input: unknown,
  metadata: ReceiveMetadata = {},
  options: A2ASourceOptions = {},
) {
  const body = sourceRecord(input);
  const message = optionalRecord(body.message) ?? body;
  const sender = optionalRecord(message.sender) ?? optionalRecord(body.agent);
  const senderId =
    (sender && (optionalString(sender, "id") ?? optionalString(sender, "name"))) ?? UNKNOWN_SENDER;
  if (options.localAgentId && senderId === options.localAgentId) {
    return [];
  }

  const parts = Array.isArray(message.parts) ? message.parts : [];
  const text =
    parts
      .map(partText)
      .filter((value): value is string => Boolean(value))
      .join("\n") ||
    optionalString(message, "text") ||
    "";
  const contextId =
    optionalString(body, "contextId") ?? optionalString(body, "context_id") ?? UNKNOWN_CONTEXT;
  const taskId = optionalString(body, "taskId") ?? optionalString(body, "task_id");
  const eventId = metadata.eventId ?? optionalString(body, "id") ?? taskId;
  const actor = remoteAgentActor(`a2a:${senderId}`, senderId);

  return newEvent({
    actor,
    channel: create(ChannelRefSchema, {
      channelId: contextId,
      provider: "a2a",
      threadId: taskId,
    }),
    conversation: create(ConversationRefSchema, {
      id: `a2a:${contextId}`,
      participants: [actor],
      status: ConversationStatus.OPEN,
    }),
    eventId,
    extensions: {
      "ocp.provider": "a2a",
      ...(taskId ? { "a2a.task_id": taskId } : {}),
    },
    idempotencyKey: metadata.idempotencyKey ?? eventId,
    occurredAt: metadata.receivedAt ? timestampFromDate(metadata.receivedAt) : undefined,
    payload: { case: "messageReceived", value: create(MessageReceivedSchema, { text }) },
    recipient: options.recipient,
    source: actor,
  });
}

/**
 * Creates the A2A `ChannelSource` for `openChannel({ channels })`.
 * Inbound messages arrive through `receive()`; this source has no background polling.
 */
export function a2aSource(options: A2ASourceOptions = {}): ChannelSource {
  return {
    normalize: async (input, metadata) => {
      try {
        return await normalizeA2AEvent(input, metadata, options);
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new ValidationError("Unable to normalize a2a input", {
          cause: error,
          provider: "a2a",
          stage: "normalize",
        });
      }
    },
    provider: "a2a",
  };
}

/** Returns a non-empty `text` field from one A2A part, or `undefined`. */
function partText(part: unknown): string | undefined {
  const record = optionalRecord(part);
  return record ? optionalString(record, "text") : undefined;
}

function remoteAgentActor(id: string, displayName: string): ActorRef {
  return create(ActorRefSchema, {
    authority: "",
    capabilities: [],
    displayName,
    id,
    type: ActorType.AGENT,
  });
}
