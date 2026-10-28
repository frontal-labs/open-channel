import { create } from "@bufbuild/protobuf";
import { ValidationError } from "@openchannelprotocol/core";
import {
  fromBinary,
  fromJson,
  MessageReceivedSchema,
  newEvent,
  toBinary,
  toJson,
} from "@openchannelprotocol/protocol";
import { createTestEvent, createTestHuman } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";

describe("OCP event envelope", () => {
  it("round-trips through ProtoJSON and binary protobuf", () => {
    const event = createTestEvent({
      actor: createTestHuman("human:gabriel", "Gabriel"),
      eventId: "evt-1",
      payload: {
        case: "messageReceived",
        value: create(MessageReceivedSchema, {
          metadata: { thread: "t-1" },
          text: "Hello from a channel",
        }),
      },
    });

    const json = toJson(event);
    const jsonRoundTrip = fromJson(json);
    const binaryRoundTrip = fromBinary(toBinary(event));

    expect(jsonRoundTrip.eventId).toBe("evt-1");
    expect(jsonRoundTrip.payload.case).toBe("messageReceived");
    expect(binaryRoundTrip.payload.case).toBe("messageReceived");
    if (binaryRoundTrip.payload.case === "messageReceived") {
      expect(binaryRoundTrip.payload.value.text).toBe("Hello from a channel");
    }
  });

  it("rejects an event whose payload is missing", () => {
    expect(() => newEvent({ payload: { case: undefined, value: undefined } as never })).toThrow(
      "must have a payload",
    );
  });

  it("validates untrusted ProtoJSON with Zod before decoding", () => {
    expect(() => fromJson({ eventId: 42 })).toThrow(ValidationError);
    expect(() =>
      newEvent({
        payload: { case: "unknown", value: {} } as never,
      }),
    ).toThrow(ValidationError);
  });
});
