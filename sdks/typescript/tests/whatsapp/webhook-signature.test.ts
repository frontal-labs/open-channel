import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWhatsAppWebhook } from "../../src/whatsapp/index.js";

const appSecret = "app-secret";
const body = '{"object":"whatsapp_business_account"}';

describe("ocp-sdk/whatsapp webhook signature", () => {
  it("accepts a sha256 signature computed over the raw body", () => {
    const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
    expect(() =>
      verifyWhatsAppWebhook({ body, headers: { "x-hub-signature-256": signature } }, appSecret),
    ).not.toThrow();
  });

  it("rejects a signature computed with a different secret", () => {
    const signature = `sha256=${createHmac("sha256", "other-secret").update(body).digest("hex")}`;
    expect(() =>
      verifyWhatsAppWebhook({ body, headers: { "x-hub-signature-256": signature } }, appSecret),
    ).toThrow("WhatsApp webhook signature is invalid");
  });

  it("rejects a request without a signature header", () => {
    expect(() => verifyWhatsAppWebhook({ body, headers: {} }, appSecret)).toThrow(
      "WhatsApp webhook signature is missing",
    );
  });
});
