import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "ocp-core";

import type { SlackWebhookRequest } from "./types.js";

/** Slack rejects signed requests whose timestamp is more than five minutes from now. */
const REPLAY_WINDOW_MS = 5 * 60_000;

/**
 * Verifies Slack's signed request before passing its body to `app.receive()`.
 *
 * Uses Slack's `v0` scheme: HMAC-SHA256 over `v0:<timestamp>:<raw body>` with the app signing
 * secret, compared against `x-slack-signature`. `now` (epoch milliseconds) is injectable for
 * tests. Throws `ValidationError` on missing headers, a non-numeric or stale timestamp, or a
 * signature mismatch.
 */
export function verifySlackWebhook(
  request: SlackWebhookRequest,
  signingSecret: string,
  now = Date.now(),
): void {
  const timestamp = request.headers["x-slack-request-timestamp"];
  const signature = request.headers["x-slack-signature"];
  if (!(timestamp && signature)) {
    throw invalid("Slack webhook headers are incomplete");
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    throw invalid("Slack webhook timestamp is invalid");
  }
  if (Math.abs(now - seconds * 1000) > REPLAY_WINDOW_MS) {
    throw invalid("Slack webhook timestamp is outside the replay window");
  }

  const body =
    typeof request.body === "string" ? request.body : Buffer.from(request.body).toString("utf8");
  const provided = signature.startsWith("v0=") ? signature.slice(3) : signature;
  const expected = createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw invalid("Slack webhook signature is invalid");
  }
}

function invalid(message: string): ValidationError {
  return new ValidationError(message, { provider: "slack", stage: "validation" });
}
