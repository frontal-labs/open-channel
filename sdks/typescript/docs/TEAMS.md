# @openchannelprotocol/sdk/teams

A Microsoft Teams channel for OCP. Bot Framework activities become OCP `message.received` events, and
approval-card submissions become `approval.decided` events. Outbound `message.sent` events post
replies through a transport you supply. Bearer tokens from the Bot Framework are verified before any
activity reaches the runtime.

## Where it sits in the OCP flow

```text
Teams activity (HTTP) -> verify bearer token -> normalize
  -> OCP message.received or approval.decided -> harness -> OCP message.sent -> Teams sendMessage
```

## Install

```sh
pnpm add @openchannelprotocol/sdk
```

## Quickstart

```ts
import {
  teamsChannel,
  teamsTokenVerifier,
  verifyTeamsWebhook,
} from "@openchannelprotocol/sdk/teams";
import { RuleBasedPolicyEngine } from "@openchannelprotocol/sdk";
import { postgresStore } from "@openchannelprotocol/sdk/postgres";
import { openChannel } from "@openchannelprotocol/sdk";

const verifyToken = teamsTokenVerifier({ appId: process.env.MICROSOFT_APP_ID ?? "" });

const app = openChannel({
  channels: [
    teamsChannel({
      botId: process.env.MICROSOFT_APP_ID,
      transport: {
        // Post one reply. Use the Bot Framework connector client here.
        sendMessage: async () => ({ messageId: "1" }),
      },
    }),
  ],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: postgresStore({ client: pool }), // pool: your PostgresClient, see POSTGRES.md
});

await app.start();

// In your HTTP handler, verify the request before passing its body on:
export async function handleActivity(request: { headers: Record<string, string | undefined>; body: unknown }) {
  await verifyTeamsWebhook({ headers: request.headers }, verifyToken);
  await app.receive("microsoft-teams", request.body);
}
```

## Authentication

`teamsTokenVerifier` fetches the Bot Framework signing keys and checks each bearer token: RS256
signature, issuer `https://api.botframework.com`, audience equal to your app ID, and expiry. Keys are
cached and refreshed when a token names an unknown key ID, at most once a minute. A failed check
returns `false`, and `verifyTeamsWebhook` then throws a `ValidationError`.

Pass the verifier as the second argument of `verifyTeamsWebhook`. The request's `authorization`
header must use the lowercase key, as Node's `IncomingMessage.headers` provides it.

## Inbound

- Message activities become `message.received`. Activities of other types are ignored.
- Approval-card submissions (`action` or `verb` of `approve` or `deny`, with an `approvalId`) become
  `approval.decided`. An approval never runs an action by itself; the runtime still needs an executor.
- The sender is the Teams user ID, or the ID your `actorResolver` returns.
- Messages from `botId` are dropped, so the bot never answers itself.

## Options

- `recipient`: the local agent that receives inbound activities. Without it the message reaches no agent.
- `botId`: the bot's own Teams user ID, used for loop prevention.
- `actorResolver`: maps a Teams user ID to an actor, for example from a directory.
- `transport.sendMessage`: posts one reply. Receives the conversation, reply target, text, attachments,
  and idempotency key.

## Safety boundary

Verify every activity before calling `receive()`. A verifier that returns `true` unconditionally turns
off authentication, so never ship one. Approval decisions come from people in Teams, but they are
still policy inputs, not commands.

## Environment

- `MICROSOFT_APP_ID`: your bot's app ID (in the example above). The package itself reads no
  environment variables.

## Tests

```sh
pnpm --filter @openchannelprotocol/sdk test
```

The tests use a generated test key pair and a fake JWKS. They need no network access.
