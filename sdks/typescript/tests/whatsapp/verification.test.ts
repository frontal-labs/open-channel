import { ValidationError } from "@openchannel/core";
import { describe, expect, it } from "vitest";
import { verifyWhatsAppChallenge } from "../../src/whatsapp/index.js";

describe("ocp-sdk/whatsapp challenge verification", () => {
  it("returns the challenge when mode and verify token match", () => {
    expect(verifyWhatsAppChallenge("subscribe", "verify-me", "123", "verify-me")).toBe("123");
  });

  it("rejects a wrong token, a wrong mode, a missing challenge, and a missing token", () => {
    expect(() => verifyWhatsAppChallenge("subscribe", "wrong", "123", "verify-me")).toThrow(
      ValidationError,
    );
    expect(() => verifyWhatsAppChallenge("unsubscribe", "verify-me", "123", "verify-me")).toThrow(
      ValidationError,
    );
    expect(() => verifyWhatsAppChallenge("subscribe", "verify-me", undefined, "verify-me")).toThrow(
      ValidationError,
    );
    expect(() => verifyWhatsAppChallenge("subscribe", undefined, "123", "verify-me")).toThrow(
      ValidationError,
    );
  });

  it("rejects a token that differs only in length", () => {
    expect(() => verifyWhatsAppChallenge("subscribe", "verify", "123", "verify-me")).toThrow(
      ValidationError,
    );
  });
});
