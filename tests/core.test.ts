import { createActionId, createCorrelationId, ValidationError } from "@openchannelprotocol/core";
import { createTestEvent, createTestEventBus } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";

const ACTION_ID_PATTERN = /^action:[0-9a-f-]{36}$/;
const CORRELATION_ID_PATTERN = /^corr:[0-9a-f-]{36}$/;

describe("OCP core", () => {
  it("publishes events to subscribers and supports unsubscribe", async () => {
    const bus = createTestEventBus<ReturnType<typeof createTestEvent>>();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((receivedEvent) => {
      received.push(receivedEvent.eventId);
    });
    const event = createTestEvent({ eventId: "core-event-1", text: "hello" });

    await bus.publish(event);
    unsubscribe();
    await bus.publish(event);

    expect(received).toEqual(["core-event-1"]);
  });

  it("creates namespaced identifiers", () => {
    expect(createActionId()).toMatch(ACTION_ID_PATTERN);
    expect(createCorrelationId()).toMatch(CORRELATION_ID_PATTERN);
  });

  it("exposes classified shared errors", () => {
    const error = new ValidationError("invalid event", { details: { field: "eventId" } });

    expect(error.code).toBe("OCP_VALIDATION");
    expect(error.details).toEqual({ field: "eventId" });
    expect(error).toBeInstanceOf(Error);
  });
});
