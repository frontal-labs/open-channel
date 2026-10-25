import { ValidationError } from "ocp-core";

/** A plain JSON object taken from an untrusted Teams payload. */
export type TeamsRecord = Record<string, unknown>;

/** Narrows an unknown value to a JSON object, or undefined for null, arrays, and scalars. */
export function optionalRecord(value: unknown): TeamsRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as TeamsRecord)
    : undefined;
}

/** Reads a non-empty string field from a Teams object. */
export function optionalString(record: TeamsRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Requires the activity body to be a JSON object. Anything else is a `ValidationError`. */
export function sourceRecord(input: unknown): TeamsRecord {
  const record = optionalRecord(input);
  if (!record) {
    throw new ValidationError("Invalid Microsoft Teams input", {
      provider: "microsoft-teams",
      stage: "normalize",
    });
  }
  return record;
}
