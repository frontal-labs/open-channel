# ocp-sdk/slack

Slack source and sink for the OpenChannel Protocol (OCP). Slack Events API messages become OCP
`message.received` events for the harness, and the harness's `message.sent` events are posted back
to Slack through an injected Web API transport. Agent routing, policy, and approvals stay in OCP;
this package only maps Slack payloads to and from OCP events.

```text
Slack Events API -> verifySlackWebhook -> app.receive("slack") -> message.received
  -> AgentHost (agent onMessage) -> message.sent -> transport.postMessage -> Slack
```

## Install

```sh
pnpm add ocp-sdk @slack/web-api @bufbuild/protobuf
```

The quickstart uses `ocp-sdk/postgres` for the event store and `@slack/web-api`
for the transport; any `EventStore` and any Slack Web API client work.

## Quickstart

```ts
import { create } from "@bufbuild/protobuf";
import { postgresStore } from "ocp-sdk/postgres";
import { slackChannel, verifySlackWebhook } from "ocp-sdk/slack";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { createTestEventStore } from "@openchannel/testing";
import { ActorRefSchema, ActorType } from "ocp-sdk";
import { WebClient } from "@slack/web-api";
import { openChannel } from "ocp-sdk";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const helper = create(ActorRefSchema, { id: "agent:slack-helper", type: ActorType.AGENT });

const app = openChannel({
  agents: [
    {
      id: "agent:slack-helper",
      name: "Slack helper",
      onMessage: async (ctx) => {
        await ctx.reply(`You said: ${ctx.message.text}`);
      },
    },
  ],
  channels: [
    slackChannel({
      botUserId: process.env.SLACK_BOT_USER_ID,
      recipient: helper,
      transport: {
        postMessage: async ({ channelId, text, threadId }) => {
          const result = await slack.chat.postMessage({ channel: channelId, text, thread_ts: threadId });
          return { messageId: result.ts };
        },
      },
    }),
  ],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: createTestEventStore(), // production: postgresStore({ client: pool }) from the postgres extension
});

await app.start();

/** Call from your HTTP handler with the raw request bytes and lowercase headers. */
export async function handleSlackEvent(rawBody: Buffer, headers: Record<string, string | undefined>) {
  verifySlackWebhook({ body: rawBody, headers }, process.env.SLACK_SIGNING_SECRET ?? "");
  const payload = JSON.parse(rawBody.toString("utf8"));
  return app.receive("slack", payload);
}
```

## Webhook verification

`verifySlackWebhook` checks Slack's `v0` signature: an HMAC-SHA256 over `v0:<timestamp>:<raw body>`
using the app signing secret, compared with `x-slack-signature`. It rejects missing headers,
non-numeric timestamps, timestamps more than five minutes from now (replay window), and mismatched
signatures, throwing `ValidationError`. Pass the body exactly as received, before any JSON parsing,
and lowercase header names. `url_verification` handshakes return no OCP events; answer them with the
challenge in your HTTP handler.

## Approval and safety boundary

- Inbound messages are only `message.received` events. Bot posts and messages from `botUserId` are
  dropped, so the app cannot reply to itself.
- Replies are `message.sent` events. They reach Slack only through the `transport` you supply, and
  they follow the Slack thread (`thread_ts`) of the inbound message.
- Actions requested through `ctx.request` are decided by the policy engine. A `requiresApproval`
  decision is a pending approval, not execution; an executor must still record the action result.
- This package never performs actions on its own and never stores credentials.

## Environment

The extension reads no environment variables. The application supplies:

- `SLACK_SIGNING_SECRET`: app signing secret used by `verifySlackWebhook`.
- `SLACK_BOT_TOKEN`: bot token used by your Web API transport.
- `SLACK_BOT_USER_ID` (optional): passed as `botUserId` to filter the app's own messages.

## Tests

```sh
pnpm --filter ocp-sdk test
```
