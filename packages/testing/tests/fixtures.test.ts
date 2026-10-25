import { ActorType, eventType as typeOf } from "ocp-protocol";
import { describe, expect, it } from "vitest";

import {
  createTestAction,
  createTestAgent,
  createTestEvent,
  createTestHuman,
  createTestMessage,
} from "../src/index.js";

describe("ocp-testing fixtures", () => {
  it("creates reusable actors and message payloads", () => {
    expect(createTestHuman().type).toBe(ActorType.HUMAN);
    expect(createTestAgent().id).toBe("agent:test");
    expect(createTestMessage().text).toBe("Test message");
    expect(createTestAction().actionId).toBe("action:test");
  });

  it("creates valid events for every protocol event type", () => {
    const eventTypes = [
      "action.executed",
      "action.failed",
      "approval.denied",
      "approval.expired",
      "approval.granted",
      "approval.requested",
      "escalation.triggered",
      "handoff.completed",
      "handoff.initiated",
      "message.received",
      "message.sent",
      "policy.allowed",
      "policy.blocked",
      "task.assigned",
      "task.created",
    ] as const;

    for (const eventType of eventTypes) {
      expect(typeOf(createTestEvent({ eventType }))).toBe(eventType);
    }
  });
});
