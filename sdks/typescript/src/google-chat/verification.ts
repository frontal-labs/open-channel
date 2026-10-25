import { ValidationError } from "ocp-core";

import type { GoogleChatWebhookRequest } from "./types.js";

/**
 * Verifies a Google Chat webhook through a host-supplied token verifier.
 *
 * The verifier is the authentication boundary. It must validate the Google-issued bearer token
 * (signature, issuer, audience). A verifier that returns true unconditionally disables
 * authentication for every inbound Google Chat request.
 */
export async function verifyGoogleChatWebhook(
  request: GoogleChatWebhookRequest,
  verifyToken: (request: GoogleChatWebhookRequest) => boolean | Promise<boolean>,
): Promise<void> {
  if (!(await verifyToken(request))) {
    throw new ValidationError("Google Chat webhook authorization is invalid", {
      provider: "google-chat",
      stage: "validation",
    });
  }
}
