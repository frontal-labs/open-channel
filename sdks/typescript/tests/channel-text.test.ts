import { create } from "@bufbuild/protobuf";
import {
  AuthorizationError,
  NotFoundError,
  TransportError,
  toChannelText,
} from "@openchannelprotocol/core";
import { ChannelRefSchema, type EventEnvelope } from "@openchannelprotocol/protocol";
import {
  createTestAgent,
  createTestChannelAdapter,
  createTestEvent,
  createTestEventStore,
  createTestHuman,
} from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";
import { RuleBasedPolicyEngine } from "../../../packages/policy/src/index.js";
import { openChannel } from "../src/index.js";

/** Text of every `message.sent` payload that would reach a channel. */
function channelTexts(events: EventEnvelope[]): string[] {
  return events.flatMap((event) =>
    event.payload.case === "messageSent" ? [event.payload.value.text] : [],
  );
}

const channel = create(ChannelRefSchema, { channelId: "channel:conformance", provider: "test" });

describe("channel conformance: developer text never reaches a channel", () => {
  it("does not post a policy denial reason or action identifier", async () => {
    const agent = createTestAgent("agent:denied", "Denied Agent");
    const human = createTestHuman();
    const adapter = createTestChannelAdapter();
    const app = openChannel({
      actions: [
        {
          execute: () => "should not run",
          type: "forbidden.action",
          validate: (input: unknown) => input,
        },
      ],
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            const result = await context.request("forbidden.action", {});
            if (result.status !== "executed") {
              await context.reply(
                toChannelText(new AuthorizationError("Rule secret-7 blocks forbidden.action")),
              );
            }
          },
        },
      ],
      channels: [{ provider: "test", sink: adapter }],
      policy: new RuleBasedPolicyEngine({
        rules: [
          {
            actionType: "forbidden.action",
            allowed: false,
            id: "secret-7",
            reason: "Rule secret-7 blocks forbidden.action",
          },
        ],
      }),
      store: createTestEventStore(),
    });

    await app.start();
    await app.ingest(createTestEvent({ actor: human, channel, recipient: agent }));
    await app.stop();

    const texts = channelTexts(adapter.sent);
    expect(texts).toEqual(["You're not allowed to do that."]);
    expect(texts.join("\n")).not.toContain("secret-7");
    expect(texts.join("\n")).not.toContain("forbidden.action");
  });

  it("does not post a not-found identifier", async () => {
    const agent = createTestAgent("agent:lookup", "Lookup Agent");
    const human = createTestHuman();
    const adapter = createTestChannelAdapter();
    const app = openChannel({
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            try {
              throw new NotFoundError("OCP agent", "agent:hidden-42");
            } catch (error) {
              await context.reply(toChannelText(error));
            }
          },
        },
      ],
      channels: [{ provider: "test", sink: adapter }],
      policy: new RuleBasedPolicyEngine({ rules: [] }),
      store: createTestEventStore(),
    });

    await app.start();
    await app.ingest(createTestEvent({ actor: human, channel, recipient: agent }));
    await app.stop();

    expect(channelTexts(adapter.sent)).toEqual(["Something went wrong."]);
    expect(channelTexts(adapter.sent).join("\n")).not.toContain("hidden-42");
  });

  it("keeps a transport failure out of the channel and in the developer hook", async () => {
    const agent = createTestAgent("agent:transport", "Transport Agent");
    const human = createTestHuman();
    const hookErrors: unknown[] = [];
    const sink = {
      provider: "test",
      send: () => Promise.reject(new TransportError("token secret-xyz was rejected")),
    };
    const app = openChannel({
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            await context.reply("hello");
          },
        },
      ],
      channels: [{ provider: "test", sink }],
      hooks: {
        onError: (error) => {
          hookErrors.push(error);
        },
      },
      policy: new RuleBasedPolicyEngine({ rules: [] }),
      store: createTestEventStore(),
    });

    await app.start();
    await app.ingest(createTestEvent({ actor: human, channel, recipient: agent }));
    await app.stop();

    // The developer message is kept for logs...
    expect(hookErrors.some((error) => String(error).includes("secret-xyz"))).toBe(true);
    // ...and the channel text for a transport failure is fixed, never the developer message.
    expect(toChannelText(new TransportError("token secret-xyz was rejected"))).toBe(
      "The message couldn't be delivered.",
    );
  });
});
