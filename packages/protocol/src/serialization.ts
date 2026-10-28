import {
  fromBinary as decodeBinary,
  fromJson as decodeJson,
  toBinary as encodeBinary,
  toJson as encodeJson,
  type JsonValue,
} from "@bufbuild/protobuf";
import { ValidationError } from "@openchannelprotocol/core";

import { validateEvent } from "./events.js";
import { type EventEnvelope, EventEnvelopeSchema } from "./generated.js";

/** Serializes a validated envelope to ProtoJSON. */
export function toJson(event: EventEnvelope): JsonValue {
  validateEvent(event);
  return encodeJson(EventEnvelopeSchema, event);
}

/**
 * Decodes and validates an untrusted ProtoJSON envelope. Protobuf's JSON decoder rejects unknown
 * fields and wrong types, so no second schema pass is needed on this path.
 */
export function fromJson(value: unknown): EventEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Invalid OCP ProtoJSON envelope: expected an object");
  }
  let event: EventEnvelope;
  try {
    event = decodeJson(EventEnvelopeSchema, value as JsonValue);
  } catch (error) {
    throw new ValidationError("Invalid OCP ProtoJSON envelope", {
      cause: error,
      details: { issues: error instanceof Error ? error.message : String(error) },
    });
  }
  validateEvent(event);
  return event;
}

/** Serializes a validated envelope to binary protobuf. */
export function toBinary(event: EventEnvelope): Uint8Array {
  validateEvent(event);
  return encodeBinary(EventEnvelopeSchema, event);
}

/** Decodes and validates a binary protobuf envelope. */
export function fromBinary(bytes: Uint8Array): EventEnvelope {
  let event: EventEnvelope;
  try {
    event = decodeBinary(EventEnvelopeSchema, bytes);
  } catch (error) {
    throw new ValidationError("Invalid OCP binary envelope", { cause: error });
  }
  validateEvent(event);
  return event;
}
