import { describe, expect, it } from "vitest";
import { googleChatTokenVerifier } from "../../src/google-chat/index.js";
import { createTestSigner } from "./jwt-test-kit.js";

const PROJECT_NUMBER = "123456789";
const NOW_MS = Date.UTC(2026, 9, 19, 12, 0, 0);
const NOW_S = NOW_MS / 1000;

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: PROJECT_NUMBER,
    exp: NOW_S + 300,
    iss: "chat@system.gserviceaccount.com",
    ...overrides,
  };
}

function bearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` } };
}

// RSA-2048 key generation is CPU-bound; parallel test workers can exceed the default 5s.
describe("Google Chat reference token verifier", { timeout: 30_000 }, () => {
  it("accepts a correctly signed Chat token for this project", async () => {
    const signer = createTestSigner("chat-key-1");
    const verify = googleChatTokenVerifier({
      fetchCerts: async () => ({ "chat-key-1": signer.pem }),
      now: () => NOW_MS,
      projectNumber: PROJECT_NUMBER,
    });
    expect(await verify(bearer(signer.sign(validClaims())))).toBe(true);
  });

  it("rejects a missing header, a token for another project, and an expired token", async () => {
    const signer = createTestSigner("chat-key-1");
    const verify = googleChatTokenVerifier({
      fetchCerts: async () => ({ "chat-key-1": signer.pem }),
      now: () => NOW_MS,
      projectNumber: PROJECT_NUMBER,
    });
    expect(await verify({ headers: {} })).toBe(false);
    expect(await verify(bearer(signer.sign(validClaims({ aud: "999" }))))).toBe(false);
    expect(await verify(bearer(signer.sign(validClaims({ exp: NOW_S - 3600 }))))).toBe(false);
  });

  it("rejects a token signed by an unpublished key and a non-RS256 algorithm", async () => {
    const trusted = createTestSigner("chat-key-1");
    const attacker = createTestSigner("chat-key-1");
    const verify = googleChatTokenVerifier({
      fetchCerts: async () => ({ "chat-key-1": trusted.pem }),
      now: () => NOW_MS,
      projectNumber: PROJECT_NUMBER,
    });
    expect(await verify(bearer(attacker.sign(validClaims())))).toBe(false);
    expect(await verify(bearer(trusted.sign(validClaims(), { alg: "HS256" })))).toBe(false);
  });
});
