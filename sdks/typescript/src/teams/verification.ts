import { ValidationError } from "@openchannelprotocol/core";

import type { TeamsWebhookRequest } from "./types.js";

const BEARER_PATTERN = /^bearer (.+)$/i;

/**
 * Extracts the token from an `Authorization: Bearer <token>` header value. The scheme name is
 * matched case-insensitively, as RFC 7235 requires. Returns undefined when the header is missing
 * or uses another scheme.
 */
export function bearerToken(authorization: string | undefined): string | undefined {
  const match = BEARER_PATTERN.exec(authorization ?? "");
  return match?.[1];
}

/**
 * Verifies a Teams bearer token through a host-supplied verifier. Expects the header under the
 * lowercase `authorization` key, as Node's `IncomingMessage.headers` provides it.
 *
 * The verifier is the authentication boundary. It must validate the Microsoft-issued JWT
 * (signature, issuer, audience, expiry). A verifier that returns true unconditionally disables
 * authentication for every inbound Teams request. Throws a `ValidationError` when the header is
 * missing or the verifier rejects the token.
 */
export async function verifyTeamsWebhook(
  request: TeamsWebhookRequest,
  verifyToken: (token: string) => boolean | Promise<boolean>,
): Promise<void> {
  const token = bearerToken(request.headers.authorization);
  if (!(token && (await verifyToken(token)))) {
    throw new ValidationError("Microsoft Teams webhook authorization is invalid", {
      provider: "microsoft-teams",
      stage: "validation",
    });
  }
}
