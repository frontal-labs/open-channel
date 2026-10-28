# Slack OCP agent

A real-channel quickstart: an OCP agent that answers messages in a Slack
channel. Inbound Slack events are verified and normalized into OCP
`message.received` events. The agent's reply goes out as a `message.sent`
event through Slack's Web API (`chat.postMessage`).

## Prerequisites

- Node.js 20 or later and pnpm, with dependencies installed: `pnpm install`
  from the repository root.
- For the real server only: a Slack workspace where you can create an app,
  and a public HTTPS URL for development (for example a `cloudflared` tunnel).

The self-test needs none of these.

## Run without Slack (no credentials)

From the repository root:

```bash
pnpm exec tsx examples/slack-typescript/src/main.ts --selftest
```

The self-test starts a local fake Slack API and a webhook server. It sends a
correctly signed Slack event and checks that the agent replies in the same
channel. It also checks that a malformed body returns 400, an oversized body
returns 413, and a forged signature returns 401. It exits non-zero on the first
failed check.

Expected output:

```text
selftest passed: replied in C123 with "Received: hello from Slack"
```

## Run against a real Slack workspace

1. **Create a Slack app** at <https://api.slack.com/apps>. Under **OAuth &
   Permissions**, add the bot scope `chat:write` and install the app to the
   workspace. Copy the **Bot User OAuth Token** (`xoxb-…`).
2. **Enable events.** Under **Event Subscriptions**, turn events on, subscribe
   the bot to `message.channels` (and `message.groups` for private channels),
   and set the **Request URL** to `https://<your-host>/slack/events`. Slack
   sends a signed `url_verification` request, which the server answers
   automatically.
3. **Invite the bot** to a channel (`/invite @your-bot`).
4. **Expose the server.** For local development, run
   `cloudflared tunnel --url http://localhost:3000` and use its URL as the
   Request URL.
5. **Set the environment and start the agent** (see the table below):

```bash
export SLACK_BOT_TOKEN=xoxb-...      # Bot User OAuth Token
export SLACK_SIGNING_SECRET=...      # Basic Information → Signing Secret
export SLACK_BOT_USER_ID=U...        # optional: stops the bot answering itself
export PORT=3000                     # optional
pnpm exec tsx examples/slack-typescript/src/main.ts
```

Post a message in the channel. The agent replies with `Received: <your text>`.
If a required variable is missing, the process exits with a message that names
the variable and where to find its value.

## Environment variables

| Variable | Required | Default | Where to find it or what it does |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | Yes (server) | none | Slack app → OAuth & Permissions → Bot User OAuth Token (`xoxb-…`). |
| `SLACK_SIGNING_SECRET` | Yes (server) | none | Slack app → Basic Information → Signing Secret. Verifies every webhook. |
| `SLACK_BOT_USER_ID` | No | unset | The bot's user id (`U…`). Messages from the bot are ignored, so it does not reply to itself. |
| `SLACK_API_BASE` | No | `https://slack.com/api` | Slack Web API base URL. Useful for pointing at a test double. |
| `PORT` | No | `3000` | Port the webhook server listens on. |
| `HOST` | No | `127.0.0.1` | Interface to bind. Set it explicitly only when a reverse proxy is in front. |

The constant names for these variables are in the `ENV` object in
`src/main.ts`. Keep the token and secret in a secret store, and never commit them.

## Files

| File | Purpose |
| --- | --- |
| `src/main.ts` | Webhook server, Slack transport, OCP app wiring, and the `--selftest` mode. |
| `src/demo-store.ts` | In-memory `EventStore`. Demo only, and it loses state on restart. |

## Expected behavior per message

```text
Slack event (signed)
  → verifySlackWebhook()            reject unsigned or replayed requests (401)
  → 200 acknowledged                Slack retries unacknowledged events
  → app.receive("slack", payload)   normalize to message.received, dedupe by event_id
  → AgentHost routes to the agent   by recipient (set in slackChannel)
  → agent handler replies           context.reply(...)
  → message.sent through the sink   Slack chat.postMessage, threaded when Slack sent a thread
```

The agent never calls Slack directly. Outbound delivery is the channel's job,
and any action beyond replying would go through `context.request(...)`, which
applies policy and approvals first.

## How this maps to OCP

| Concept | Where it appears |
| --- | --- |
| Channel adapter (source and sink) | `slackChannel()` in `createSlackApp` |
| Inbound verification | `verifySlackWebhook()` in `createWebhookServer` |
| Outbound delivery | `createSlackWebApiTransport()` calls `chat.postMessage` |
| Agent identity | The `helper` actor and the `agents[]` entry in `createSlackApp` |
| Idempotent intake | `app.receive(..., { eventId })` deduplicates Slack `event_id` |
| Policy | `RuleBasedPolicyEngine({ rules: [] })`. No actions are allowed |
| Event store | `createDemoEventStore()`, replaced by a durable store in production |

## Production notes

- **Store.** `src/main.ts` uses the demo-only in-memory store in
  `src/demo-store.ts`. Use `@openchannelprotocol/sdk/postgres` in production.
- **Policy.** The policy is empty, so the agent can only reply. Add rules before
  granting it any action.
- **Retries.** Slack retries unacknowledged deliveries. Events are deduplicated
  by `event_id`, so a retry does not produce a second reply.
- **Secrets.** Keep `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` in your secret
  store. Do not commit them.
