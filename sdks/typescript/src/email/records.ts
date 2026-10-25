import { ValidationError } from "ocp-core";

/** A plain JSON object taken from an untrusted email payload. */
export type EmailRecord = Record<string, unknown>;

/** Requires the inbound message to be a JSON object, classifying anything else as invalid input. */
export function sourceRecord(input: unknown): EmailRecord {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Invalid email input", { provider: "email", stage: "normalize" });
  }
  return input as EmailRecord;
}
