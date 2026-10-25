import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ChannelSource, ReceiveMetadata } from "ocp-adapter";
import { OpenChannelError, ValidationError } from "ocp-core";
import type { ActorRef, EventEnvelope } from "ocp-protocol";
import {
  ActorRefSchema,
  ActorType,
  ChannelRefSchema,
  ConversationRefSchema,
  ConversationStatus,
  MessageReceivedSchema,
  newEvent,
} from "ocp-protocol";

import { sourceRecord } from "./records.js";
import type { EmailMessage, EmailPoller, EmailSourceOptions } from "./types.js";

/**
 * Normalizes one inbound email into an OCP `message.received` event.
 *
 * Resolves to `[]` (the message is dropped, not an error) when the payload has no `from`, no
 * `text`, or the source has no `mailbox`. HTML-only mail is therefore dropped. The sender becomes
 * a human actor unless `actorResolver` supplies one. The conversation is keyed by the thread
 * root when available, so replies group together.
 */
export async function normalizeEmailMessage(
  input: unknown,
  options: EmailSourceOptions,
  metadata: ReceiveMetadata = {},
) {
  const message = sourceRecord(input) as unknown as EmailMessage;
  if (!(message.from && message.text && options.mailbox)) {
    return [];
  }
  const actor = options.actorResolver
    ? await options.actorResolver(message.from)
    : humanActor(`email:${message.from}`, message.from);
  const eventId = metadata.eventId ?? message.id;
  const threadId = message.threadId ?? message.inReplyTo ?? message.references?.at(-1);
  // `to` is untrusted input; a missing value must not throw inside the polling loop.
  const to = Array.isArray(message.to) ? message.to.join(",") : "";

  return newEvent({
    actor,
    channel: create(ChannelRefSchema, {
      address: message.from,
      channelId: options.mailbox,
      provider: "email",
      threadId,
    }),
    conversation: create(ConversationRefSchema, {
      id: `email:${threadId ?? message.id ?? message.subject ?? message.from}`,
      participants: [actor],
      status: ConversationStatus.OPEN,
    }),
    eventId,
    extensions: {
      "ocp.provider": "email",
      ...(message.subject ? { "email.subject": message.subject } : {}),
      ...(message.id ? { "email.message_id": message.id } : {}),
    },
    idempotencyKey: metadata.idempotencyKey ?? eventId,
    occurredAt: metadata.receivedAt ? timestampFromDate(metadata.receivedAt) : undefined,
    payload: {
      case: "messageReceived",
      value: create(MessageReceivedSchema, {
        metadata: {
          from: message.from,
          subject: message.subject ?? "",
          to,
        },
        text: message.text,
      }),
    },
    recipient: options.recipient,
    source: actor,
  });
}

/**
 * Creates the email `ChannelSource`.
 *
 * Without a `poller` the source only supports `receive()` calls from the host (for example a
 * webhook handler). With a `poller`, the gateway runs `start()` in the background and calls
 * `poller.stop()` from `stop()`; the poller must make a pending `poll()` iterator finish once
 * `stop()` runs, or `app.stop()` will wait on it.
 */
export function emailSource(options: EmailSourceOptions): ChannelSource {
  const { poller } = options;
  return {
    normalize: async (input, metadata) => {
      try {
        return await normalizeEmailMessage(input, options, metadata);
      } catch (error) {
        if (error instanceof OpenChannelError) {
          throw error;
        }
        throw new ValidationError("Unable to normalize email input", {
          cause: error,
          provider: "email",
          stage: "normalize",
        });
      }
    },
    provider: "email",
    ...(poller
      ? {
          start: (emit, signal) => pollInbound(poller, options, emit, signal),
          // Wrapped so the poller's method keeps its `this` binding.
          stop: () => poller.stop?.(),
        }
      : {}),
  };
}

/**
 * Emits each polled message in arrival order. Stops early when the signal aborts. Errors from the
 * poller or from `emit` reject this promise, which the gateway reports through its `onError`.
 */
async function pollInbound(
  poller: EmailPoller,
  options: EmailSourceOptions,
  emit: (event: EventEnvelope) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  for await (const message of poller.poll(signal)) {
    if (signal.aborted) {
      return;
    }
    const normalized = await normalizeEmailMessage(message, options, { receivedAt: new Date() });
    // A dropped message normalizes to `[]`; a kept one is always a single event.
    if (Array.isArray(normalized)) {
      continue;
    }
    await emit(normalized);
  }
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
