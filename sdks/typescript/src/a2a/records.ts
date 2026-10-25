import { ValidationError } from "ocp-core";

/** A plain JSON object taken from an untrusted A2A payload. */
export type A2ARecord = Record<string, unknown>;

/** Narrows an unknown value to a JSON object, or `undefined` for null, arrays, and scalars. */
export function optionalRecord(value: unknown): A2ARecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as A2ARecord)
    : undefined;
}

/** Reads a field as a string. Empty strings count as absent. */
export function optionalString(record: A2ARecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Requires the inbound payload to be a JSON object; anything else is invalid input. */
export function sourceRecord(input: unknown): A2ARecord {
  const record = optionalRecord(input);
  if (!record) {
    throw new ValidationError("Invalid a2a input", { provider: "a2a", stage: "normalize" });
  }
  return record;
}
