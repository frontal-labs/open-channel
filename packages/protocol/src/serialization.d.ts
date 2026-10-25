import { type JsonValue } from "@bufbuild/protobuf";
import { type EventEnvelope } from "./generated.js";
/** Serializes a validated envelope to ProtoJSON. */
export declare function toJson(event: EventEnvelope): JsonValue;
/**
 * Decodes and validates an untrusted ProtoJSON envelope. Protobuf's JSON decoder rejects unknown
 * fields and wrong types, so no second schema pass is needed on this path.
 */
export declare function fromJson(value: unknown): EventEnvelope;
/** Serializes a validated envelope to binary protobuf. */
export declare function toBinary(event: EventEnvelope): Uint8Array;
/** Decodes and validates a binary protobuf envelope. */
export declare function fromBinary(bytes: Uint8Array): EventEnvelope;
//# sourceMappingURL=serialization.d.ts.map
