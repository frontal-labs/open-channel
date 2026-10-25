import { create } from "@bufbuild/protobuf";
import type { OpenChannelError } from "ocp-core";
import { ActorType, ChannelRefSchema, eventType } from "ocp-protocol";
import {
  createTestAgent,
  createTestChannelAdapter,
  createTestConversation,
  createTestEvent,
  createTestEventStore,
  createTestHuman,
  type TestEventStore,
} from "ocp-testing";
import { describe, expect, it } from "vitest";
import { RuleBasedPolicyEngine } from "../../../packages/policy/src/index.js";
import { ChannelGateway, OpenChannelRuntime } from "../../../packages/runtime/src/index.js";
import { AgentHost, action, openChannel } from "../src/index.js";

/** Wraps a test store so each write waits, letting shutdown overlap with runtime processing. */
function createSlowEventStore(): TestEventStore {
  const store = createTestEventStore();
  const pause = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  return {
    all: () => store.all(),
    append: async (event) => {
      await pause();
      return store.append(event);
    },
    appendIfAbsent: async (event) => {
      await pause();
      return store.appendIfAbsent(event);
    },
    claimAction: (actionId, owner) => store.claimAction(actionId, owner),
    close: () => store.close(),
    completeAction: (actionId, result) => store.completeAction(actionId, result),
    failAction: (actionId, error) => store.failAction(actionId, error),
    get: (eventId) => store.get(eventId),
    getAction: (actionId) => store.getAction(actionId),
    has: (eventId) => store.has(eventId),
    list: (options) => store.list(options),
    query: (options) => store.query(options),
  };
}

describe("ocp-sdk", () => {
  it("routes a message to an agent and dispatches its reply", async () => {
    const adapter = createTestChannelAdapter();
    const runtime = new OpenChannelRuntime({
      eventStore: createTestEventStore(),
      policy: new RuleBasedPolicyEngine({ rules: [] }),
    });
    const gateway = new ChannelGateway(runtime, [adapter]);
    const host = new AgentHost({ gateway, runtime });
    const agent = createTestAgent("agent:sdk", "SDK Agent");

    host.register({
      id: agent.id,
      name: agent.displayName,
      onMessage: async (context) => {
        await context.reply(`Echo: ${context.message.text}`);
      },
      skills: [{ id: "echo", name: "Echo" }],
    });
    host.attach();

    await runtime.process(
      createTestEvent({
        actor: createTestHuman(),
        channel: create(ChannelRefSchema, { channelId: "channel:sdk", provider: "test" }),
        eventType: "message.received",
        recipient: agent,
        text: "hello",
      }),
    );

    expect(host.agentCards().find((card) => card.id === agent.id)?.skills[0]?.id).toBe("echo");
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]?.payload.case).toBe("messageSent");
    expect(agent.type).toBe(ActorType.AGENT);
  });

  it("builds an application with typed actions and lifecycle management", async () => {
    const adapter = createTestChannelAdapter();
    const executed: number[] = [];
    const agent = createTestAgent("agent:app", "App Agent");
    const human = createTestHuman("human:app", "App Human");
    const increment = action<{ value: number }, number>({
      execute: (input) => {
        executed.push(input.value);
        return input.value + 1;
      },
      type: "counter.increment",
      validate: (input: unknown) => {
        if (!input || typeof input !== "object" || !("value" in input)) {
          throw new Error("value is required");
        }
        return input as { value: number };
      },
    });
    const app = openChannel({
      actions: [increment],
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            await context.request("counter.increment", { value: 2 });
            await context.reply("done");
          },
        },
      ],
      channels: [{ provider: "test", sink: adapter }],
      policy: new RuleBasedPolicyEngine({
        rules: [{ actionType: "counter.increment", allowed: true, id: "counter" }],
      }),
      store: createTestEventStore(),
    });

    await app.start();
    await app.ingest(
      createTestEvent({
        actor: human,
        channel: create(ChannelRefSchema, { channelId: "channel:app", provider: "test" }),
        conversation: undefined,
        recipient: agent,
      }),
    );
    await app.stop();

    expect(executed).toEqual([2]);
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0] && eventType(adapter.sent[0])).toBe("message.sent");
  });

  it("executes a registered action only after approval", async () => {
    const agent = createTestAgent("agent:approval", "Approval Agent");
    const approver = createTestHuman("human:approver", "Approver");
    let executions = 0;
    let approvalId = "";
    const app = openChannel({
      actions: [
        {
          execute: () => {
            executions += 1;
            return "updated";
          },
          type: "sensitive.update",
          validate: (input: unknown) => input,
        },
      ],
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            const result = await context.request(
              "sensitive.update",
              {},
              {
                approver,
                reason: "Needs review",
              },
            );
            if (result.status === "approval_required") {
              ({ approvalId } = result);
            }
          },
        },
      ],
      policy: new RuleBasedPolicyEngine({
        rules: [
          {
            actionType: "sensitive.update",
            allowed: true,
            id: "review",
            requiresApproval: true,
          },
        ],
      }),
      store: createTestEventStore(),
    });

    await app.start();
    await app.ingest(createTestEvent({ actor: createTestHuman(), recipient: agent }));
    expect(executions).toBe(0);
    expect(approvalId).toBeTruthy();

    await app.approve(approvalId, approver);
    await app.stop();

    expect(executions).toBe(1);
  });

  it("normalizes source input, deduplicates intake, and preserves raw context", async () => {
    const adapter = createTestChannelAdapter();
    const sourceEvents: string[] = [];
    const agent = createTestAgent("agent:source", "Source Agent");
    const inbound = createTestEvent({ eventId: "source-event", recipient: agent });
    const source = {
      normalize: async () => inbound,
      provider: "test",
      start: () => {
        sourceEvents.push("started");
      },
      stop: () => {
        sourceEvents.push("stopped");
      },
    };
    let rawEvent: unknown;
    const app = openChannel({
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            ({ event: rawEvent } = context);
            await context.reply("source reply", { recipient: context.agent });
          },
        },
      ],
      channels: [{ provider: "test", sink: adapter, source }],
      policy: new RuleBasedPolicyEngine({ rules: [] }),
      store: createTestEventStore(),
    });

    await app.start();
    const first = await app.receive("test", { message: "hello" });
    const second = await app.receive("test", { message: "hello again" });
    await app.stop();

    expect(first[0]?.duplicate).toBe(false);
    expect(second[0]?.duplicate).toBe(true);
    expect(rawEvent).toBe(inbound);
    expect(adapter.sent).toHaveLength(1);
    expect(sourceEvents).toEqual(["started", "stopped"]);
  });

  it("executes an action id at most once and audits failures", async () => {
    const agent = createTestAgent("agent:duplicate", "Duplicate Agent");
    const human = createTestHuman("human:duplicate");
    let executions = 0;
    const app = openChannel({
      actions: [
        {
          execute: () => {
            executions += 1;
            throw new Error("provider unavailable");
          },
          type: "duplicate.action",
          validate: (input: unknown) => input,
        },
      ],
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            const first = await context.request(
              "duplicate.action",
              {},
              {
                actionId: "action:once",
              },
            );
            const second = await context.request(
              "duplicate.action",
              {},
              {
                actionId: "action:once",
              },
            );
            expect(first.status).toBe("failed");
            expect(second.status).toBe("failed");
          },
        },
      ],
      policy: new RuleBasedPolicyEngine({
        rules: [{ actionType: "duplicate.action", allowed: true, id: "allow" }],
      }),
      store: createTestEventStore(),
    });

    await app.start();
    await app.ingest(createTestEvent({ actor: human, recipient: agent }));
    await app.stop();

    expect(executions).toBe(1);
    expect(await app.runtime.queryEvents({ eventType: "action.failed" })).toHaveLength(1);
  });

  it("serializes work in one conversation while allowing another conversation to run", async () => {
    const agent = createTestAgent("agent:concurrency", "Concurrency Agent");
    let active = 0;
    let peak = 0;
    const release = new Map<string, () => void>();
    const app = openChannel({
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise<void>((resolve) => release.set(context.event.eventId, resolve));
            active -= 1;
          },
        },
      ],
      concurrency: 2,
      policy: new RuleBasedPolicyEngine({ rules: [] }),
      store: createTestEventStore(),
    });
    await app.start();
    const first = createTestEvent({
      conversation: createTestConversation("conversation:serial"),
      eventId: "serial-1",
      recipient: agent,
    });
    const second = createTestEvent({
      conversation: createTestConversation("conversation:serial"),
      eventId: "serial-2",
      recipient: agent,
    });
    const third = createTestEvent({
      conversation: createTestConversation("conversation:parallel"),
      eventId: "parallel-1",
      recipient: agent,
    });
    const firstRun = app.ingest(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondRun = app.ingest(second);
    const thirdRun = app.ingest(third);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(2);
    release.get("serial-1")?.();
    release.get("parallel-1")?.();
    await Promise.all([firstRun, thirdRun]);
    release.get("serial-2")?.();
    await secondRun;
    await app.stop();
  });

  it("isolates a failing app.on handler and reports it through onError", async () => {
    const agent = createTestAgent("agent:on-handler", "On Handler Agent");
    const errors: OpenChannelError[] = [];
    const seen: string[] = [];
    const app = openChannel({
      agents: [{ id: agent.id, name: agent.displayName, onMessage: async () => undefined }],
      hooks: {
        onError: (error) => {
          errors.push(error);
        },
      },
      policy: new RuleBasedPolicyEngine({ rules: [] }),
      store: createTestEventStore(),
    });
    app.on("message.received", () => {
      throw new Error("handler boom");
    });
    app.on("message.received", (event) => {
      seen.push(event.eventId);
    });

    await app.start();
    await app.ingest(createTestEvent({ eventId: "on-handler-1", recipient: agent }));
    await app.stop();

    expect(seen).toEqual(["on-handler-1"]);
    const failure = errors.find((error) => error.message === "handler boom");
    expect(failure?.eventId).toBe("on-handler-1");
  });

  it("drains in-flight replies before stopping even when persistence is slow", async () => {
    const adapter = createTestChannelAdapter();
    const agent = createTestAgent("agent:drain", "Drain Agent");
    const human = createTestHuman("human:drain", "Drain Human");
    const app = openChannel({
      agents: [
        {
          id: agent.id,
          name: agent.displayName,
          onMessage: async (context) => {
            await context.reply("late reply");
          },
        },
      ],
      channels: [{ provider: "test", sink: adapter }],
      policy: new RuleBasedPolicyEngine({ rules: [] }),
      store: createSlowEventStore(),
    });

    await app.start();
    const pending = app.ingest(
      createTestEvent({
        actor: human,
        channel: create(ChannelRefSchema, { channelId: "channel:drain", provider: "test" }),
        eventId: "drain-1",
        recipient: agent,
      }),
    );
    await app.stop();
    await pending;

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]?.payload.case).toBe("messageSent");
  });
});
