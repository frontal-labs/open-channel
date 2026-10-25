# ocp-sdk/email

An email channel for OCP. Inbound mail becomes OCP `message.received` events, and outbound
`message.sent` events are delivered as replies through an SMTP or API transport you supply. Threads
follow `In-Reply-To` and `References`, so agent replies stay in the same conversation.

## Where it sits in the OCP flow

```text
inbound mail (IMAP poll or webhook) -> normalize -> OCP message.received
  -> harness -> OCP message.sent -> email transport -> reply in the same thread
```

## Install

```sh
pnpm add ocp-sdk
```

## Quickstart

```ts
import { emailChannel } from "ocp-sdk/email";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { createTestEventStore } from "@openchannel/testing";
import { openChannel } from "ocp-sdk";

const app = openChannel({
  channels: [
    emailChannel({
      mailbox: "agent@example.com",
      transport: {
        // Send one reply. Use nodemailer, a mail API, or any SMTP client here.
        sendEmail: async (input) => ({ messageId: `<${input.id}@example.com>` }),
      },
    }),
  ],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: createTestEventStore(),
});

await app.start();
await app.receive("email", {
  id: "<msg-1@example.org>",
  from: "customer@example.org",
  subject: "Invoice question",
  text: "Can you resend invoice 1001?",
  to: ["agent@example.com"],
});
```

## Inbound

- A message is dropped when it has no `from`, no `text`, or no `mailbox`. HTML-only mail is dropped.
- The thread ID is `threadId`, then `inReplyTo`, then the last entry of `references`.
- `email.subject` and `email.message_id` are copied into the event so replies can quote the subject and
  set `In-Reply-To`.
- The actor is a human with ID `email:<address>`, unless `actorResolver` maps the address first.

## Outbound

- Replies go to `recipient.id`, falling back to `channel.address`.
- The subject is `Re: <original subject>` when known, otherwise `OCP message`.
- Transport failures are rethrown as retryable `TransportError`s, so the runtime retries the delivery.

## Polling

Pass `poller` to pull mail instead of, or as well as, calling `receive()`. The poller's `poll(signal)`
must yield messages while `signal` is live and finish once it aborts. `stop()` releases the connection.

## Options

- `mailbox` (required): the address this channel receives on.
- `recipient`: the local agent that receives inbound mail. Without it the message reaches no agent.
- `actorResolver`: maps a sender address to an actor, for example from a directory.
- `poller`: optional long-running inbound feed.

## Safety boundary

Anyone can email the mailbox. Treat inbound text as untrusted input and rely on policy for anything the
agent does in response. Use SPF, DKIM, and DMARC on the sending side, and check them in your inbound
pipeline before calling `receive()`.

## Environment

None in the package. Your transport and poller supply SMTP, IMAP, or API credentials.

## Tests

```sh
pnpm --filter ocp-sdk test
```

The tests use fake transports and pollers and need no mail server.
