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
import type { GoogleChatSourceOptions } from "./types.js";

/** Normalizes Google Chat app events into v1 OCP message events. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Provider payload variants are normalized in one boundary function.
export async function normalizeGoogleChatEvent(
  input: unknown,
  metadata: ReceiveMetadata = {},
  options: GoogleChatSourceOptions = {},
) {
  const body = sourceRecord(input);
  if (optionalString(body, "type") && optionalString(body, "type") !== "MESSAGE") {
    return [];
  }
  const message = optionalRecord(body.message) ?? body;
  const sender = optionalRecord(message.sender);
  const actorId = optionalString(sender ?? {}, "name") ?? optionalString(sender ?? {}, "email");
  const space = optionalRecord(body.space) ?? optionalRecord(message.space);
  const spaceName = optionalString(space ?? {}, "name") ?? optionalString(message, "space");
  if (!(actorId && spaceName)) {
    return [];
  }
  if (options.appId && actorId === options.appId) {
    return [];
  }
  const actor = options.actorResolver
    ? await options.actorResolver(actorId)
    : humanActor(`google-chat:${actorId}`, optionalString(sender ?? {}, "displayName") ?? actorId);
  const eventId =
    metadata.eventId ?? optionalString(body, "eventId") ?? optionalString(message, "name");
  const thread = optionalRecord(message.thread);

  return newEvent({
    actor,
    channel: create(ChannelRefSchema, {
      channelId: spaceName,
      provider: "google-chat",
      threadId: optionalString(thread ?? {}, "name"),
    }),
    conversation: create(ConversationRefSchema, {
      id: `google-chat:${spaceName}`,
      participants: [actor],
      status: ConversationStatus.OPEN,
    }),
    eventId,
    extensions: { "ocp.provider": "google-chat" },
    idempotencyKey: metadata.idempotencyKey ?? eventId,
    occurredAt: metadata.receivedAt ? timestampFromDate(metadata.receivedAt) : undefined,
    payload: {
      case: "messageReceived",
      value: create(MessageReceivedSchema, { text: optionalString(message, "text") ?? "" }),
    },
    recipient: options.recipient,
    source: actor,
  });
}

/** Creates a Google Chat source for `openChannel({ channels })`. */
export function googleChatSource(options: GoogleChatSourceOptions = {}): ChannelSource {
  return {
    normalize: async (input, metadata) => {
      try {
        return await normalizeGoogleChatEvent(input, metadata, options);
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new ValidationError("Unable to normalize google-chat input", {
          cause: error,
          provider: "google-chat",
          stage: "normalize",
        });
      }
    },
    provider: "google-chat",
  };
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
