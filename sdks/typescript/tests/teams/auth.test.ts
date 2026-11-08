import { describe, expect, it } from "vitest";
import { teamsTokenVerifier } from "../../src/teams/index.js";
import { createTestSigner } from "./jwt-test-kit.js";

const APP_ID = "00000000-0000-0000-0000-000000000001";
const NOW_MS = Date.UTC(2026, 9, 19, 12, 0, 0);
const NOW_S = NOW_MS / 1000;

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: APP_ID,
    exp: NOW_S + 300,
    iss: "https://api.botframework.com",
    nbf: NOW_S - 60,
    ...overrides,
  };
}

function setup() {
  const signer = createTestSigner("teams-key-1");
  const verify = teamsTokenVerifier({
    appId: APP_ID,
    fetchJwks: async () => ({ keys: [signer.jwk] }),
    now: () => NOW_MS,
  });
  return { signer, verify };
}

// RSA-2048 key generation is CPU-bound; parallel test workers can exceed the default 5s.
describe("Teams reference token verifier", { timeout: 30_000 }, () => {
  it("accepts a correctly signed Bot Framework token for this app", async () => {
    const { signer, verify } = setup();
    expect(await verify(signer.sign(validClaims()))).toBe(true);
  });

  it("rejects a token for another app, another issuer, or an expired token", async () => {
    const { signer, verify } = setup();
    expect(await verify(signer.sign(validClaims({ aud: "someone-else" })))).toBe(false);
    expect(await verify(signer.sign(validClaims({ iss: "https://evil.example" })))).toBe(false);
    expect(await verify(signer.sign(validClaims({ exp: NOW_S - 3600 })))).toBe(false);
  });

  it("rejects an unsigned token, a tampered payload, and an unknown key", async () => {
    const { signer, verify } = setup();
    const token = signer.sign(validClaims());
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify(validClaims({ aud: "stolen" }))).toString(
      "base64url",
    );
    expect(await verify(`${header}.${forgedPayload}.${signature}`)).toBe(false);
    expect(await verify(signer.sign(validClaims(), { kid: "unknown" }))).toBe(false);
    const none = Buffer.from(JSON.stringify({ alg: "none", kid: "teams-key-1" })).toString(
      "base64url",
    );
    const body = Buffer.from(JSON.stringify(validClaims())).toString("base64url");
    expect(await verify(`${none}.${body}.`)).toBe(false);
    expect(await verify("not-a-jwt")).toBe(false);
  });

  it("rejects a token signed with a key the provider never published", async () => {
    const trusted = createTestSigner("teams-key-1");
    const attacker = createTestSigner("teams-key-1");
    const verify = teamsTokenVerifier({
      appId: APP_ID,
      fetchJwks: async () => ({ keys: [trusted.jwk] }),
      now: () => NOW_MS,
    });
    expect(await verify(attacker.sign(validClaims()))).toBe(false);
  });
});
