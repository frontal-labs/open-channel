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

import { optionalRecord, optionalString, recordItems, sourceRecord } from "./records.js";
import type { WhatsAppSourceOptions } from "./types.js";

/**
 * Normalizes a WhatsApp Business Cloud webhook payload into a `message.received` OCP event.
 *
 * Only the first message of each change is read, and the first usable message wins: the
 * function returns after building one event, and `[]` when none qualifies. Messages without
 * a sender or `phone_number_id`, and messages for other business numbers when
 * `businessPhoneNumberId` is set, are skipped. The channel address is the sender phone number
 * (used as the reply target), the channel `threadId` is the WhatsApp message id, and the
 * conversation is `whatsapp:<phone>`.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Provider payload variants are normalized in one boundary function.
export async function normalizeWhatsAppEvent(
  input: unknown,
  metadata: ReceiveMetadata = {},
  options: WhatsAppSourceOptions = {},
) {
  const body = sourceRecord(input);
  for (const entry of recordItems(body.entry)) {
    for (const change of recordItems(entry.changes)) {
      const value = optionalRecord(change.value);
      const messages = recordItems(value?.messages);
      const [message] = messages;
      if (!message) {
        continue;
      }
      const from = optionalString(message, "from");
      const metadataRecord = optionalRecord(value?.metadata);
      const phoneNumberId = optionalString(metadataRecord ?? {}, "phone_number_id");
      if (!(from && phoneNumberId)) {
        continue;
      }
      if (options.businessPhoneNumberId && phoneNumberId !== options.businessPhoneNumberId) {
        continue;
      }
      const actor = options.actorResolver
        ? // biome-ignore lint/performance/noAwaitInLoops: Preserve provider message order.
          await options.actorResolver(from)
        : humanActor(`whatsapp:${from}`, from);
      const textRecord = optionalRecord(message.text);
      const eventId = metadata.eventId ?? optionalString(message, "id");

      return newEvent({
        actor,
        channel: create(ChannelRefSchema, {
          address: from,
          channelId: phoneNumberId,
          provider: "whatsapp",
          threadId: eventId,
        }),
        conversation: create(ConversationRefSchema, {
          id: `whatsapp:${from}`,
          participants: [actor],
          status: ConversationStatus.OPEN,
        }),
        eventId,
        extensions: {
          "ocp.provider": "whatsapp",
          "whatsapp.phone_number_id": phoneNumberId,
          ...(eventId ? { "whatsapp.message_id": eventId } : {}),
        },
        idempotencyKey: metadata.idempotencyKey ?? eventId,
        occurredAt: metadata.receivedAt ? timestampFromDate(metadata.receivedAt) : undefined,
        payload: {
          case: "messageReceived",
          value: create(MessageReceivedSchema, {
            metadata: { messageType: optionalString(message, "type") ?? "text", phone: from },
            text: optionalString(textRecord ?? {}, "body") ?? "",
          }),
        },
        recipient: options.recipient,
        source: actor,
      });
    }
  }
  return [];
}

/** Creates a WhatsApp source for `openChannel({ channels })`. */
export function whatsappSource(options: WhatsAppSourceOptions = {}): ChannelSource {
  return {
    normalize: async (input, metadata) => {
      try {
        return await normalizeWhatsAppEvent(input, metadata, options);
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new ValidationError("Unable to normalize whatsapp input", {
          cause: error,
          provider: "whatsapp",
          stage: "normalize",
        });
      }
    },
    provider: "whatsapp",
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
