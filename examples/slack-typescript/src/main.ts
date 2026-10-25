/**
 * Slack OCP example: an agent that answers messages in a Slack channel.
 *
 * OCP concepts demonstrated:
 * - `slackChannel()` is the channel adapter. Its source turns a Slack event into a
 *   `message.received` event. Its sink turns a `message.sent` event into `chat.postMessage`.
 * - `verifySlackWebhook()` checks the Slack signing secret before any event enters OCP.
 * - `app.receive()` deduplicates by Slack `event_id`, so a retried delivery is not answered twice.
 * - The agent calls `context.reply()` and never calls Slack directly. Delivery is the channel's job.
 *
 * Modes:
 * - `--selftest` runs a local fake Slack API and webhook server. It needs no credentials.
 * - Default mode starts the real webhook server. It needs the environment variables in
 *   `ENV` below. See `examples/slack-typescript/README.md`.
 */
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { create } from "@bufbuild/protobuf";
import { ActorRefSchema, ActorType, openChannel, RuleBasedPolicyEngine } from "ocp-sdk";
import { type SlackTransport, slackChannel, verifySlackWebhook } from "ocp-sdk/slack";

import { createDemoEventStore } from "./demo-store.js";

/** Environment variable names read by the real server. Each is documented in the README. */
const ENV = {
  /** Override the Slack Web API base URL. Optional. Used to point at a fake API. */
  API_BASE: "SLACK_API_BASE",
  /** Bot User OAuth Token (`xoxb-...`). Required. Slack app → OAuth & Permissions. */
  BOT_TOKEN: "SLACK_BOT_TOKEN",
  /** Bot's own user id (`U...`). Optional. Stops the bot from answering its own posts. */
  BOT_USER_ID: "SLACK_BOT_USER_ID",
  /** Interface to bind. Optional. */
  HOST: "HOST",
  /** TCP port for the webhook server. Optional. */
  PORT: "PORT",
  /** Signing secret used to verify webhooks. Required. Slack app → Basic Information. */
  SIGNING_SECRET: "SLACK_SIGNING_SECRET",
} as const;

/** Where to find each required credential. Used in the error message when one is missing. */
const CREDENTIAL_HINTS: Record<string, string> = {
  [ENV.BOT_TOKEN]:
    "Set it to the Bot User OAuth Token (xoxb-...) from https://api.slack.com/apps → OAuth & Permissions.",
  [ENV.SIGNING_SECRET]:
    "Set it to the Signing Secret from https://api.slack.com/apps → Basic Information.",
};

/** Default Slack Web API base URL. Override with `SLACK_API_BASE`. */
const DEFAULT_SLACK_API_BASE = "https://slack.com/api";

/** Default webhook port when `PORT` is unset. */
const DEFAULT_PORT = 3000;

/**
 * Default bind address. Loopback keeps a development server off the network. Expose it
 * through a tunnel, or set `HOST` when a reverse proxy sits in front.
 */
const DEFAULT_HOST = "127.0.0.1";

/** Route that receives Slack Events API requests. Must match the app's Request URL path. */
const EVENTS_PATH = "/slack/events";

/** Agent identifier for the helper agent that answers Slack messages. */
const HELPER_AGENT_ID = "agent:slack-helper";

/** Fixed signing secret used only by the self-test. Not a real credential. */
const SELFTEST_SIGNING_SECRET = "selftest-signing-secret";

/** Channel id used by the self-test event and expected in the reply. */
const SELFTEST_CHANNEL = "C123";

/** Fixed Slack message timestamp returned by the fake API. Keeps the self-test deterministic. */
const SELFTEST_MESSAGE_TS = "1700000000.000100";

/** How long the self-test waits for the asynchronous reply before failing. */
const SELFTEST_TIMEOUT_MS = 5000;

/** Polling interval while the self-test waits for the reply. */
const SELFTEST_POLL_MS = 25;

/** Whether this process runs the self-test instead of the real server. */
const SELFTEST = process.argv.includes("--selftest");

/**
 * Creates a `SlackTransport` that calls the Slack Web API `chat.postMessage` method.
 *
 * This is the only outbound network call the agent makes. Errors from Slack (`ok: false`)
 * are rethrown with Slack's error code so the failure is easy to read.
 *
 * @param token - Bot User OAuth Token (`xoxb-...`), sent as a Bearer token.
 * @param apiBase - Base URL of the Slack Web API, without a trailing slash.
 * @returns A transport whose `postMessage` resolves to the posted message timestamp.
 */
export function createSlackWebApiTransport(token: string, apiBase: string): SlackTransport {
  return {
    postMessage: async ({ channelId, signal, text, threadId }) => {
      const response = await fetch(`${apiBase}/chat.postMessage`, {
        body: JSON.stringify({ channel: channelId, text, thread_ts: threadId }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal,
      });
      const body = (await response.json()) as { error?: string; ok: boolean; ts?: string };
      if (!body.ok) {
        throw new Error(`Slack chat.postMessage failed: ${body.error ?? response.status}`);
      }
      return { messageId: body.ts };
    },
  };
}

/**
 * Builds the OCP app: one Slack channel, one helper agent, and an empty policy.
 *
 * The policy has no rules, so the agent can only reply. Add rules before granting it any action.
 *
 * @param options.botUserId - The bot's Slack user id. Messages from it are ignored.
 * @param options.transport - The outbound Slack transport, usually `createSlackWebApiTransport`.
 * @returns An `openChannel()` app. Call `start()` before receiving events.
 */
export function createSlackApp(options: { botUserId?: string; transport: SlackTransport }) {
  const helper = create(ActorRefSchema, { id: HELPER_AGENT_ID, type: ActorType.AGENT });
  return openChannel({
    agents: [
      {
        description: "Replies to Slack messages sent to the workspace",
        id: HELPER_AGENT_ID,
        name: "Slack Helper",
        /** Echoes the inbound text back. A real agent would call its model here. */
        onMessage: async (context) => {
          await context.reply(`Received: ${context.message.text}`);
        },
        skills: [{ id: "respond", name: "Respond in Slack" }],
      },
    ],
    channels: [
      slackChannel({
        botUserId: options.botUserId,
        recipient: helper,
        transport: options.transport,
      }),
    ],
    policy: new RuleBasedPolicyEngine({ rules: [] }),
    // Demo-only in-memory store. Production deployments use a durable store such as
    // ocp-sdk/postgres.
    store: createDemoEventStore(),
  });
}

/** Largest request body the webhook accepts. Slack event payloads are far smaller. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Thrown when a request body exceeds `MAX_BODY_BYTES`. Mapped to HTTP 413. */
class BodyTooLargeError extends Error {}

/**
 * Reads a request body into a single buffer, stopping early if it grows past `MAX_BODY_BYTES`.
 *
 * @param request - The incoming HTTP request.
 * @returns The full body. Rejects with `BodyTooLargeError` when the limit is exceeded.
 */
function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/**
 * Writes a JSON response. An empty body is sent when `body` is undefined.
 *
 * @param response - The server response to write to.
 * @param status - HTTP status code.
 * @param body - Optional JSON-serializable body.
 */
function respond(response: ServerResponse, status: number, body?: unknown): void {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (status === 413) {
    // Close after rejecting an oversized body so the client does not keep uploading.
    headers.connection = "close";
  }
  response.writeHead(status, headers);
  response.end(body === undefined ? "" : JSON.stringify(body));
}

/**
 * Creates the webhook HTTP server for Slack Events API requests.
 *
 * Flow per request:
 * 1. Accept only `POST EVENTS_PATH` (anything else is 404).
 * 2. Verify the Slack signature over the raw body (401 on failure).
 * 3. Answer `url_verification` with the challenge, as Slack requires.
 * 4. Acknowledge other events with 200 before processing, so Slack does not retry.
 * 5. Hand the event to OCP with `app.receive()`. Processing errors are logged, not returned.
 *
 * @param options.app - The OCP app that receives verified events.
 * @param options.signingSecret - Slack signing secret used for verification.
 * @returns An unstarted Node HTTP server. The caller decides which port to listen on.
 */
export function createWebhookServer(options: {
  app: ReturnType<typeof createSlackApp>;
  signingSecret: string;
}) {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== EVENTS_PATH) {
      respond(response, 404);
      return;
    }
    let raw: Buffer;
    try {
      raw = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        respond(response, 413, { error: "request body too large" });
      } else {
        respond(response, 400, { error: "unreadable request body" });
      }
      return;
    }
    // Signature check runs on the raw bytes, before any JSON parsing.
    try {
      verifySlackWebhook(
        {
          body: raw,
          headers: {
            "x-slack-request-timestamp": request.headers["x-slack-request-timestamp"] as
              | string
              | undefined,
            "x-slack-signature": request.headers["x-slack-signature"] as string | undefined,
          },
        },
        options.signingSecret,
      );
    } catch {
      respond(response, 401, { error: "invalid Slack signature" });
      return;
    }
    let payload: { challenge?: string; event_id?: string; type: string };
    try {
      payload = JSON.parse(raw.toString("utf8")) as typeof payload;
    } catch {
      respond(response, 400, { error: "malformed Slack event" });
      return;
    }
    // Slack sends this once when you save the Request URL. Echo the challenge back.
    if (payload.type === "url_verification") {
      respond(response, 200, { challenge: payload.challenge });
      return;
    }
    // Slack retries unacknowledged deliveries, so acknowledge first and process after.
    respond(response, 200);
    options.app.receive("slack", payload, { eventId: payload.event_id }).catch((error: unknown) => {
      console.error("OCP could not process the Slack event:", error);
    });
  });
}

/**
 * Starts listening on a port and resolves with the bound port.
 *
 * @param server - The HTTP server to start.
 * @param port - Port to bind. `0` picks a free port, which the self-test uses.
 * @returns The actual port the server is listening on.
 */
function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, () => resolve((server.address() as AddressInfo).port));
  });
}

/**
 * Produces a Slack-style request signature: `v0=` + HMAC-SHA256 of `v0:<timestamp>:<body>`.
 * Used only by the self-test to create valid and forged requests.
 *
 * @param secret - The signing secret.
 * @param timestamp - Unix seconds, as a string.
 * @param body - The exact request body that will be sent.
 * @returns The signature header value.
 */
function sign(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return `v0=${digest}`;
}

/**
 * Deterministic end-to-end check against a local fake Slack API. No credentials needed.
 *
 * It verifies, in order:
 * - a correctly signed event returns 200 and produces one reply in the same channel,
 * - a signed but malformed body returns 400,
 * - an oversized body returns 413,
 * - a forged signature returns 401.
 *
 * Throws on the first failed check, so `pnpm exec tsx ... --selftest` exits non-zero.
 */
async function selftest(): Promise<void> {
  const posted: { channel: string; text: string }[] = [];
  // Fake Slack Web API: records each chat.postMessage call and returns a fixed timestamp.
  const fakeSlack = createServer(async (slackRequest, slackResponse) => {
    const message = JSON.parse((await readBody(slackRequest)).toString("utf8")) as {
      channel: string;
      text: string;
    };
    posted.push(message);
    respond(slackResponse, 200, { ok: true, ts: SELFTEST_MESSAGE_TS });
  });
  const fakeSlackPort = await listen(fakeSlack, 0);

  const app = createSlackApp({
    botUserId: "UBOT",
    transport: createSlackWebApiTransport("xoxb-selftest", `http://127.0.0.1:${fakeSlackPort}`),
  });
  const webhook = createWebhookServer({ app, signingSecret: SELFTEST_SIGNING_SECRET });
  await app.start();
  const webhookPort = await listen(webhook, 0);
  const webhookUrl = `http://127.0.0.1:${webhookPort}${EVENTS_PATH}`;

  // A valid Slack message event from a human user (U1) in channel C123.
  const body = JSON.stringify({
    event: {
      channel: SELFTEST_CHANNEL,
      text: "hello from Slack",
      ts: "123.456",
      type: "message",
      user: "U1",
    },
    event_id: "Ev-selftest-1",
    type: "event_callback",
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(webhookUrl, {
    body,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": sign(SELFTEST_SIGNING_SECRET, timestamp, body),
    },
    method: "POST",
  });

  // The same body signed with the wrong secret must be rejected.
  const forged = await fetch(webhookUrl, {
    body,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": sign("wrong-secret", timestamp, body),
    },
    method: "POST",
  });

  // A correctly signed body that is not JSON must be rejected as malformed.
  const malformedBody = "{not json";
  const malformed = await fetch(webhookUrl, {
    body: malformedBody,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": sign(SELFTEST_SIGNING_SECRET, timestamp, malformedBody),
    },
    method: "POST",
  });

  // An unsigned body over the size limit must be rejected before it is buffered.
  const oversized = await fetch(webhookUrl, {
    body: "x".repeat(MAX_BODY_BYTES + 1),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((result) => result.status);

  // The reply is asynchronous, so poll for it up to the timeout.
  const deadline = Date.now() + SELFTEST_TIMEOUT_MS;
  while (posted.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SELFTEST_POLL_MS));
  }
  await app.stop();
  webhook.close();
  fakeSlack.close();

  if (response.status !== 200) {
    throw new Error(`Webhook returned ${response.status}`);
  }
  if (malformed.status !== 400) {
    throw new Error(`A signed malformed body returned ${malformed.status}, expected 400`);
  }
  if (oversized !== 413) {
    throw new Error(`An oversized body returned ${oversized}, expected 413`);
  }
  if (forged.status !== 401) {
    throw new Error(`A forged signature returned ${forged.status}, expected 401`);
  }
  if (posted.length !== 1 || posted[0]?.channel !== SELFTEST_CHANNEL) {
    throw new Error(
      `Expected one reply in ${SELFTEST_CHANNEL}, received ${JSON.stringify(posted)}`,
    );
  }
  console.log(`selftest passed: replied in ${posted[0].channel} with "${posted[0].text}"`);
}

/**
 * Starts the real webhook server using the environment variables in `ENV`.
 *
 * Fails fast with a clear message if a required credential is missing. Stops accepting
 * webhooks on SIGINT or SIGTERM and then waits for in-flight work to finish.
 */
async function serve(): Promise<void> {
  const token = requiredEnv(ENV.BOT_TOKEN);
  const secret = requiredEnv(ENV.SIGNING_SECRET);
  const app = createSlackApp({
    botUserId: process.env[ENV.BOT_USER_ID],
    transport: createSlackWebApiTransport(
      token,
      process.env[ENV.API_BASE] ?? DEFAULT_SLACK_API_BASE,
    ),
  });
  await app.start();
  const port = Number(process.env[ENV.PORT] ?? DEFAULT_PORT);
  const host = process.env[ENV.HOST] ?? DEFAULT_HOST;
  const server = createWebhookServer({ app, signingSecret: secret });
  server.listen(port, host, () => {
    console.log(`OCP Slack agent listening on http://${host}:${port} (POST ${EVENTS_PATH})`);
  });

  // Stop accepting webhooks, then let in-flight conversations finish before the process exits.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    app.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Reads a required environment variable or throws an error that says what to set and where
 * to find the value.
 *
 * @param name - An environment variable name from `ENV`.
 * @returns The non-empty value.
 * @throws When the variable is unset or empty.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    const hint =
      CREDENTIAL_HINTS[name] ?? "Set it as described in examples/slack-typescript/README.md.";
    throw new Error(`Missing ${name}. ${hint}`);
  }
  return value;
}

if (SELFTEST) {
  await selftest();
} else {
  await serve();
}
