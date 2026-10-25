import { messageReceived } from "ocp-sdk";
import { describe, expect, it } from "vitest";
import { otelHooks } from "../../src/otel/index.js";

describe("ocp-sdk/otel", () => {
  it("creates hooks compatible with OpenChannel", async () => {
    const spans: string[] = [];
    const hooks = otelHooks({
      tracer: { startActiveSpan: (name, callback) => callback({ end: () => spans.push(name) }) },
    });
    await hooks.onEventAccepted?.(messageReceived({ eventId: "1", text: "hi" }));
    expect(spans).toEqual(["ocp.event.accepted"]);
  });

  it("does not throw into the SDK when the tracer or a counter fails", () => {
    const hooks = otelHooks({
      counters: {
        events: {
          add: () => {
            throw new Error("meter down");
          },
        },
      },
      tracer: {
        startActiveSpan: () => {
          throw new Error("tracer down");
        },
      },
    });
    const event = messageReceived({ eventId: "2", text: "hi" });
    expect(() => hooks.onEventAccepted?.(event)).not.toThrow();
    expect(() => hooks.onEventProcessed?.(event)).not.toThrow();
    expect(() => hooks.onError?.({} as never)).not.toThrow();
  });

  it("tags counters and delivery spans with stable attribute names", () => {
    const counted: { name: string; attributes?: Record<string, string | number | boolean> }[] = [];
    const attributes: Record<string, unknown>[] = [];
    const hooks = otelHooks({
      counters: {
        deliveries: {
          add: (_value, tags) => counted.push({ attributes: tags, name: "deliveries" }),
        },
      },
      tracer: {
        startActiveSpan: (name, callback) => {
          const span = {
            end: () => attributes.push({ name }),
            setAttribute: (key: string, value: unknown) => attributes.push({ key, name, value }),
          };
          return callback(span);
        },
      },
    });

    hooks.onDelivery?.({
      eventId: "event:3",
      externalId: "",
      provider: "slack",
    } as never);

    expect(counted).toEqual([{ attributes: { provider: "slack" }, name: "deliveries" }]);
    expect(attributes).toEqual([
      { key: "ocp.event_id", name: "ocp.delivery", value: "event:3" },
      { key: "ocp.provider", name: "ocp.delivery", value: "slack" },
      { name: "ocp.delivery" },
    ]);
  });
});
