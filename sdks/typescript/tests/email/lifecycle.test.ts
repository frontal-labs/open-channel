import type { EventEnvelope } from "@openchannelprotocol/protocol";
import { describe, expect, it } from "vitest";
import { type EmailMessage, type EmailPoller, emailSource } from "../../src/email/index.js";

/** Poller that yields fixed messages and records whether `stop` ran on this instance. */
class FixturePoller implements EmailPoller {
  closed = false;
  private readonly messages: EmailMessage[];

  constructor(messages: EmailMessage[]) {
    this.messages = messages;
  }

  poll(signal: AbortSignal): AsyncIterable<EmailMessage> {
    const pending = [...this.messages];
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const message = pending.shift();
          if (signal.aborted || message === undefined) {
            return Promise.resolve({ done: true, value: undefined });
          }
          return Promise.resolve({ done: false, value: message });
        },
      }),
    };
  }

  stop(): void {
    this.closed = true;
  }
}

function textOf(event: EventEnvelope): string | undefined {
  return event.payload.case === "messageReceived" ? event.payload.value.text : undefined;
}

describe("@openchannelprotocol/sdk/email lifecycle", () => {
  it("emits polled messages in order and skips messages with no body", async () => {
    const poller = new FixturePoller([
      { from: "a@example.com", text: "first", to: ["agent@example.com"] },
      { from: "b@example.com", text: "", to: ["agent@example.com"] },
      { from: "c@example.com", text: "third", to: ["agent@example.com"] },
    ]);
    const source = emailSource({ mailbox: "agent@example.com", poller });
    const emitted: EventEnvelope[] = [];

    await source.start?.((event) => {
      emitted.push(event);
      return Promise.resolve();
    }, new AbortController().signal);

    expect(emitted.map(textOf)).toEqual(["first", "third"]);
  });

  it("does not stop polling when a message lacks a recipient list", async () => {
    const poller = new FixturePoller([
      { from: "a@example.com", text: "no recipients" } as EmailMessage,
      { from: "b@example.com", text: "still delivered", to: ["agent@example.com"] },
    ]);
    const source = emailSource({ mailbox: "agent@example.com", poller });
    const emitted: EventEnvelope[] = [];

    await source.start?.((event) => {
      emitted.push(event);
      return Promise.resolve();
    }, new AbortController().signal);

    expect(emitted.map(textOf)).toEqual(["no recipients", "still delivered"]);
  });

  it("calls stop on the poller instance so its own state is updated", async () => {
    const poller = new FixturePoller([]);
    const source = emailSource({ mailbox: "agent@example.com", poller });

    await source.stop?.();

    expect(poller.closed).toBe(true);
  });
});
