import { ValidationError } from "@openchannelprotocol/core";

/** A plain JSON object taken from an untrusted Slack payload. */
export type SlackRecord = Record<string, unknown>;

/** Narrows an unknown value to a JSON object, or undefined for null, arrays, and scalars. */
export function optionalRecord(value: unknown): SlackRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SlackRecord)
    : undefined;
}

/** Reads a non-empty string field from a Slack object. */
export function optionalString(record: SlackRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Requires the webhook body to be a JSON object, classifying anything else as invalid input. */
export function sourceRecord(input: unknown): SlackRecord {
  const record = optionalRecord(input);
  if (!record) {
    throw new ValidationError("Invalid Slack input", { provider: "Slack", stage: "normalize" });
  }
  return record;
}
