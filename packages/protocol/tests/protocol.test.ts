import { create } from "@bufbuild/protobuf";
import { ValidationError } from "ocp-core";
import { describe, expect, it } from "vitest";
import {
  ActionRequestSchema,
  ActorRefSchema,
  ActorType,
  actionExecuted,
  approvalRequested,
  eventType,
  fromBinary,
  fromJson,
  MessageReceivedSchema,
  messageReceived,
  newEvent,
  PROTOCOL_VERSION,
  toBinary,
  toJson,
  validateEvent,
} from "../src/index.js";

const message = create(MessageReceivedSchema, { text: "hello" });

describe("ocp-protocol", () => {
  it("round-trips an event through ProtoJSON and binary protobuf", () => {
    const event = newEvent({
      actor: create(ActorRefSchema, { id: "human:test", type: ActorType.HUMAN }),
      eventId: "protocol-test",
      payload: { case: "messageReceived", value: message },
    });

    expect(event.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(fromJson(toJson(event)).eventId).toBe("protocol-test");
    expect(fromBinary(toBinary(event)).payload.case).toBe("messageReceived");
  });

  it("derives the friendly event name from the payload", () => {
    expect(eventType(messageReceived({ text: "hi" }))).toBe("message.received");
    expect(
      eventType(
        approvalRequested({
          agent: create(ActorRefSchema, { id: "agent:a", type: ActorType.AGENT }),
          approvalId: "approval:1",
          approver: create(ActorRefSchema, { id: "human:h", type: ActorType.HUMAN }),
          deadline: new Date("2030-01-01T00:00:00Z"),
          reason: "review",
          requestedAction: create(ActionRequestSchema, { actionId: "a1", type: "reply" }),
        }),
      ),
    ).toBe("approval.requested");
  });

  it("does not store a separate event type on the wire", () => {
    const json = toJson(messageReceived({ eventId: "no-type", text: "hi" }));

    expect(json).not.toHaveProperty("eventType");
    expect(json).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
  });

  it("rejects an envelope with a missing or foreign protocol version", () => {
    const event = messageReceived({ text: "hi" });

    expect(() => validateEvent({ ...event, protocolVersion: "0.1" })).toThrow(
      `requires protocol_version ${PROTOCOL_VERSION}`,
    );
    expect(() => validateEvent({ ...event, protocolVersion: "" })).toThrow(
      `requires protocol_version ${PROTOCOL_VERSION}`,
    );
  });

  it("rejects invalid untrusted JSON", () => {
    expect(() => fromJson({ eventId: 42 })).toThrow(ValidationError);
  });

  it("builds every typed event through the same API", () => {
    const action = create(ActionRequestSchema, {
      actionId: "action:derived",
      parameters: { input: "{}" },
      target: "customer:1",
      type: "customer.reply",
    });
    const executed = actionExecuted({ action, eventId: "exec-1", result: "ok" });

    expect(eventType(executed)).toBe("action.executed");
    expect(fromBinary(toBinary(executed)).eventId).toBe("exec-1");
  });

  it("round-trips binary without any version argument", () => {
    const binary = toBinary(messageReceived({ eventId: "bin-1", text: "hi" }));

    expect(fromBinary(binary).eventId).toBe("bin-1");
  });
});
