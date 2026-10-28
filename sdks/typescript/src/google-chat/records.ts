import { ValidationError } from "@openchannelprotocol/core";

/** A plain JSON object taken from an untrusted Google Chat payload. */
export type GoogleChatRecord = Record<string, unknown>;

/** Narrows an unknown value to a JSON object, or undefined for null, arrays, and scalars. */
export function optionalRecord(value: unknown): GoogleChatRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as GoogleChatRecord)
    : undefined;
}

/** Reads a non-empty string field from a Google Chat object. */
export function optionalString(record: GoogleChatRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Requires the webhook body to be a JSON object, classifying anything else as invalid input. */
export function sourceRecord(input: unknown): GoogleChatRecord {
  const record = optionalRecord(input);
  if (!record) {
    throw new ValidationError("Invalid Google Chat input", {
      provider: "Google Chat",
      stage: "normalize",
    });
  }
  return record;
}
