import { ValidationError } from "@openchannelprotocol/core";

/** A plain JSON object taken from an untrusted WhatsApp payload. */
export type WhatsAppRecord = Record<string, unknown>;

/** Narrows an unknown value to a JSON object, or undefined for null, arrays, and scalars. */
export function optionalRecord(value: unknown): WhatsAppRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as WhatsAppRecord)
    : undefined;
}

/** Reads a non-empty string field from a WhatsApp object. */
export function optionalString(record: WhatsAppRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reads an array field, keeping only the entries that are JSON objects. */
export function recordItems(value: unknown): WhatsAppRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is WhatsAppRecord => Boolean(optionalRecord(item)))
    : [];
}

/** Requires the webhook body to be a JSON object, classifying anything else as invalid input. */
export function sourceRecord(input: unknown): WhatsAppRecord {
  const record = optionalRecord(input);
  if (!record) {
    throw new ValidationError("Invalid WhatsApp input", {
      provider: "WhatsApp",
      stage: "normalize",
    });
  }
  return record;
}
