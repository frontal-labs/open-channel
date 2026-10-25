import { createHmac, timingSafeEqual } from "node:crypto";

import { ValidationError } from "ocp-core";

import type { WhatsAppWebhookRequest } from "./types.js";

/**
 * Verifies the WhatsApp Business Cloud webhook signature (`x-hub-signature-256`).
 *
 * The header is `sha256=<hex>`, an HMAC-SHA256 of the raw request body keyed with the app
 * secret. Pass the body before any JSON parsing or re-serialization. Throws `ValidationError`
 * when the header is missing or does not match.
 */
export function verifyWhatsAppWebhook(request: WhatsAppWebhookRequest, appSecret: string): void {
  const signature = request.headers["x-hub-signature-256"];
  if (!signature) {
    throw new ValidationError("WhatsApp webhook signature is missing", {
      provider: "whatsapp",
      stage: "validation",
    });
  }
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", appSecret)
    .update(typeof request.body === "string" ? Buffer.from(request.body) : request.body)
    .digest("hex");
  if (!constantTimeEqual(provided, expected)) {
    throw new ValidationError("WhatsApp webhook signature is invalid", {
      provider: "whatsapp",
      stage: "validation",
    });
  }
}

/**
 * Validates the GET challenge used when registering a WhatsApp webhook.
 *
 * Requires `hub.mode` to be `subscribe` and `hub.verify_token` to equal `expectedToken`, then
 * returns `hub.challenge` so the HTTP handler can echo it back as the response body.
 */
export function verifyWhatsAppChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
  expectedToken: string,
): string {
  if (mode !== "subscribe" || !(challenge && constantTimeEqual(token, expectedToken))) {
    throw new ValidationError("WhatsApp webhook challenge is invalid", {
      provider: "whatsapp",
      stage: "validation",
    });
  }
  return challenge;
}

/** Compares secrets in constant time; unequal lengths and missing values are never equal. */
function constantTimeEqual(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) {
    return false;
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
