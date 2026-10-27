# ocp-sdk/whatsapp

WhatsApp Business Cloud source and sink for the OpenChannel Protocol (OCP). Inbound WhatsApp text
messages become OCP `message.received` events for the harness, and the harness's `message.sent`
events are sent back through an injected Cloud API transport. Agent routing, policy, and approvals
stay in OCP; this package only maps WhatsApp webhook payloads to and from OCP events.

```text
WhatsApp webhook -> verifyWhatsAppWebhook -> app.receive("whatsapp") -> message.received
  -> AgentHost (agent onMessage) -> message.sent -> transport.sendMessage -> WhatsApp
```

## Install

```sh
pnpm add ocp-sdk @bufbuild/protobuf
```

The quickstart uses `ocp-sdk/postgres` for the event store; any `EventStore`
works. The transport is yours to write: it calls the WhatsApp Cloud API `messages` endpoint.

## Quickstart

```ts
import { create } from "@bufbuild/protobuf";
import { postgresStore } from "ocp-sdk/postgres";
import { whatsappChannel, verifyWhatsAppWebhook } from "ocp-sdk/whatsapp";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { ActorRefSchema, ActorType } from "ocp-sdk";
import { openChannel } from "ocp-sdk";

const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const helper = create(ActorRefSchema, { id: "agent:whatsapp-helper", type: ActorType.AGENT });

const app = openChannel({
  agents: [
    {
      id: "agent:whatsapp-helper",
      name: "WhatsApp helper",
      onMessage: async (ctx) => {
        await ctx.reply(`You said: ${ctx.message.text}`);
      },
    },
  ],
  channels: [
    whatsappChannel({
      // The sink sends to recipient.id, so use the bare phone number as the actor id.
      actorResolver: (phone) =>
        create(ActorRefSchema, { id: phone, type: ActorType.HUMAN, displayName: phone }),
      businessPhoneNumberId: phoneNumberId,
      phoneNumberId,
      recipient: helper,
      transport: {
        sendMessage: async ({ phoneNumberId: from, to, text, idempotencyKey, signal }) => {
          const response = await fetch(`https://graph.facebook.com/v21.0/${from}/messages`, {
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
            headers: {
              authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
              "content-type": "application/json",
              ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
            },
            method: "POST",
            signal,
          });
          const body = (await response.json()) as { messages?: { id: string }[] };
          return { messageId: body.messages?.[0]?.id };
        },
      },
    }),
  ],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: postgresStore({ client: pool }), // pool: your PostgresClient, see POSTGRES.md
});

await app.start();

/** POST webhook: verify the raw bytes, then parse and hand the object to OCP. */
export async function handleWhatsAppEvent(rawBody: Buffer, headers: Record<string, string | undefined>) {
  verifyWhatsAppWebhook({ body: rawBody, headers }, process.env.WHATSAPP_APP_SECRET ?? "");
  return app.receive("whatsapp", JSON.parse(rawBody.toString("utf8")));
}
```

## Webhook verification

Registration (GET) is checked by `verifyWhatsAppChallenge(mode, token, challenge, expectedToken)`. It
requires `hub.mode` to be `subscribe` and `hub.verify_token` to match in constant time, and returns
`hub.challenge` for your handler to echo back. Delivery (POST) is checked by
`verifyWhatsAppWebhook`, which compares `x-hub-signature-256` (`sha256=<hex>`, an HMAC-SHA256 of the
raw body keyed with the app secret). Verify before parsing, and pass lowercase header names. A missing
or mismatched signature throws `ValidationError`.

## Approval and safety boundary

- Only text messages from the configured `businessPhoneNumberId` become events; other business
  numbers on the same app are ignored.
- Replies are `message.sent` events. They reach WhatsApp only through the `transport` you supply,
  and only text payloads are sent.
- Actions requested through `ctx.request` are decided by the policy engine. A `requiresApproval`
  decision is a pending approval, not execution; an executor must still record the action result.
- This package never performs actions on its own and never stores credentials.

## Known limitations

- The sink addresses a reply to `recipient.id`, falling back to `channel.address`. The default
  sender actor id is `whatsapp:<phone>`, so set `actorResolver` as shown above, or the reply goes to
  an invalid number.
- Only the first message of each webhook change is normalized, and only one event is returned per
  webhook call.

## Environment

The extension reads no environment variables. The application supplies:

- `WHATSAPP_APP_SECRET`: app secret used by `verifyWhatsAppWebhook`.
- `WHATSAPP_ACCESS_TOKEN`: Cloud API access token used by your transport.
- `WHATSAPP_PHONE_NUMBER_ID`: business phone number ID for outbound messages and inbound filtering.
- Your verify token for the GET challenge, passed as `expectedToken`.

## Tests

```sh
pnpm --filter ocp-sdk test
```
