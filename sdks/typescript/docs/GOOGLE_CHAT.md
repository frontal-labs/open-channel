# ocp-sdk/google-chat

A Google Chat channel for OCP. Chat app events become OCP `message.received` events, and outbound
`message.sent` events post messages back to the space through a transport you supply. Bearer tokens
from Google are verified before any event reaches the runtime.

## Where it sits in the OCP flow

```text
Google Chat event (HTTP) -> verify bearer token -> normalize -> OCP message.received
  -> harness -> OCP message.sent -> Chat API createMessage -> reply in the thread
```

## Install

```sh
pnpm add ocp-sdk
```

## Quickstart

```ts
import {
  googleChatChannel,
  googleChatTokenVerifier,
  verifyGoogleChatWebhook,
} from "ocp-sdk/google-chat";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { createTestEventStore } from "@openchannel/testing";
import { openChannel } from "ocp-sdk";

const verifyToken = googleChatTokenVerifier({
  projectNumber: process.env.GOOGLE_CLOUD_PROJECT_NUMBER ?? "",
});

const app = openChannel({
  channels: [
    googleChatChannel({
      transport: {
        // Post one message to the space. Use the Google Chat API client here.
        createMessage: async () => ({ messageId: "spaces/AAA/messages/1" }),
      },
    }),
  ],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: createTestEventStore(),
});

await app.start();

// In your HTTP handler, verify the request before passing its body on:
export async function handleChatEvent(request: { headers: Record<string, string | undefined>; body: unknown }) {
  await verifyGoogleChatWebhook(request, verifyToken);
  await app.receive("google-chat", request.body);
}
```

## Authentication

`googleChatTokenVerifier` fetches Google's signing certificates and checks each bearer token:
RS256 signature, issuer `chat@system.gserviceaccount.com`, audience equal to your project number, and
expiry. Keys are cached and refreshed when a token names an unknown key ID, at most once a minute.
Any failure makes the verifier return `false`, and `verifyGoogleChatWebhook` then throws a
`ValidationError`.

`verifyGoogleChatWebhook` takes any verifier you supply, so you can use a different check in tests.
Never pass a verifier that returns `true` unconditionally in production.

## Inbound

- Only `MESSAGE` events produce an event. Other event types return nothing.
- The sender is `sender.name`, falling back to `sender.email`. The space is `space.name`.
- The thread is `thread.name`. The event ID is `eventId`, falling back to the message name.
- Messages from the app itself (`appId`) are dropped.

## Options

- `recipient`: the local agent that receives inbound messages. Without it the message reaches no agent.
- `appId`: your app's sender name, used for loop prevention.
- `actorResolver`: maps a Chat user name to an actor, for example from a directory.
- `transport.createMessage`: posts one message. Receives the space, thread, text, and idempotency key.

## Safety boundary

Verify every request before calling `receive()`. Google Chat sends events to any HTTP endpoint you
register, so an endpoint without verification accepts forged events. Policy still decides what the
agent may do in response to a verified message.

## Environment

- `GOOGLE_CLOUD_PROJECT_NUMBER`: the project number used as the token audience (in the example above).
  The package itself reads no environment variables.

## Tests

```sh
pnpm --filter ocp-sdk test
```

The tests use a generated test key pair and fake certificates. They need no network access.
