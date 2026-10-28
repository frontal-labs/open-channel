import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ChannelSource, ReceiveMetadata } from "@openchannelprotocol/adapter";
import { OpenChannelError, ValidationError } from "@openchannelprotocol/core";
import type { ActorRef } from "@openchannelprotocol/protocol";
import {
  ActorRefSchema,
  ActorType,
  ChannelRefSchema,
  ConversationRefSchema,
  ConversationStatus,
  MessageReceivedSchema,
  newEvent,
} from "@openchannelprotocol/protocol";

import { optionalRecord, optionalString, sourceRecord } from "./records.js";
import type { SlackSourceOptions } from "./types.js";

/**
 * Normalizes a Slack Events API payload into a `message.received` OCP event.
 *
 * Returns `[]` for anything that is not an inbound human message: `url_verification`
 * handshakes (answer those in the HTTP layer), non-`message` events, bot posts (`bot_id` or
 * `bot_message`), messages without a user or channel, and messages from `botUserId`.
 * The conversation is `slack:<channel>`, the channel `threadId` is `thread_ts` (or `ts` for
 * a top-level message), and the event id is `event_id`, then `client_msg_id`, unless
 * `metadata.eventId` is set.
 */
export async function normalizeSlackEvent(
  input: unknown,
  metadata: ReceiveMetadata = {},
  options: SlackSourceOptions = {},
) {
  const envelope = sourceRecord(input);
  if (optionalString(envelope, "type") === "url_verification") {
    return [];
  }
  const event = optionalRecord(envelope.event) ?? envelope;
  if (optionalString(event, "type") !== "message") {
    return [];
  }
  if (optionalString(event, "subtype") === "bot_message" || optionalString(event, "bot_id")) {
    return [];
  }
  const userId = optionalString(event, "user");
  const channelId = optionalString(event, "channel");
  if (!(userId && channelId)) {
    return [];
  }
  if (options.botUserId && userId === options.botUserId) {
    return [];
  }
  const actor = options.actorResolver
    ? await options.actorResolver(userId)
    : humanActor(`slack:${userId}`, userId);
  const threadId = optionalString(event, "thread_ts") ?? optionalString(event, "ts");
  const messageTs = optionalString(event, "ts");
  const eventId =
    metadata.eventId ??
    optionalString(envelope, "event_id") ??
    optionalString(event, "client_msg_id");

  return newEvent({
    actor,
    channel: create(ChannelRefSchema, { channelId, provider: "slack", threadId }),
    conversation: create(ConversationRefSchema, {
      id: `slack:${channelId}`,
      participants: [actor],
      status: ConversationStatus.OPEN,
    }),
    eventId,
    extensions: {
      "ocp.provider": "slack",
      ...(messageTs ? { "slack.message_ts": messageTs } : {}),
    },
    idempotencyKey: metadata.idempotencyKey ?? eventId,
    occurredAt: metadata.receivedAt ? timestampFromDate(metadata.receivedAt) : undefined,
    payload: {
      case: "messageReceived",
      value: create(MessageReceivedSchema, { text: optionalString(event, "text") ?? "" }),
    },
    recipient: options.recipient,
    source: actor,
  });
}

/** Creates a Slack `ChannelSource` for `openChannel({ channels })`. */
export function slackSource(options: SlackSourceOptions = {}): ChannelSource {
  return {
    normalize: async (input, metadata) => {
      try {
        return await normalizeSlackEvent(input, metadata, options);
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new ValidationError("Unable to normalize slack input", {
          cause: error,
          provider: "slack",
          stage: "normalize",
        });
      }
    },
    provider: "slack",
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
