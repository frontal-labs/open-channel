import type { EventEnvelope, EventType } from "ocp-protocol";
import { eventType } from "ocp-protocol";
import { createTestEvent, createTestEventStore } from "ocp-testing";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../src/index.js";

function event(eventId: string, type: EventType = "message.received"): EventEnvelope {
  return createTestEvent({ eventId, eventType: type }) as EventEnvelope;
}

describe("createTestEventStore", () => {
  it("keeps arrival order even when event IDs look like integers", async () => {
    const store = createTestEventStore();
    await Promise.all(["10", "2", "1"].map((id) => store.append(event(id))));

    const ids = (await store.all()).map((item) => item.eventId);
    expect(ids).toEqual(["10", "2", "1"]);
  });

  it("returns the most recent events when a limit is given", async () => {
    const store = createTestEventStore();
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.append(event(`evt-${index}`))));

    const recent = await store.list({ limit: 2 });
    expect(recent.map((item) => item.eventId)).toEqual(["evt-3", "evt-4"]);
  });

  it("filters by event type before applying the limit", async () => {
    const store = createTestEventStore();
    await store.append(event("a", "message.received"));
    await store.append(event("b", "message.sent"));
    await store.append(event("c", "message.received"));

    const matches = await store.list({ eventType: "message.received", limit: 1 });
    expect(matches.map((item) => item.eventId)).toEqual(["c"]);
  });

  it("replaces an appended event in place without changing its position", async () => {
    const store = createTestEventStore();
    await store.append(event("first"));
    await store.append(event("second"));
    await store.append(event("first", "message.sent"));

    expect((await store.all()).map((item) => item.eventId)).toEqual(["first", "second"]);
    expect(eventType((await store.get("first")) as EventEnvelope)).toBe("message.sent");
  });

  it("does not append duplicates through appendIfAbsent", async () => {
    const store = createTestEventStore();
    expect(await store.appendIfAbsent(event("dup"))).toBe(true);
    expect(await store.appendIfAbsent(event("dup"))).toBe(false);
    expect(await store.has("dup")).toBe(true);
    expect(await store.get("missing")).toBeUndefined();
  });
});

describe("ManualClock", () => {
  it("fires due timers in due-time order and keeps scheduling order for ties", async () => {
    const clock = new ManualClock(new Date(0));
    const fired: string[] = [];
    clock.schedule(30, () => {
      fired.push("late");
    });
    clock.schedule(10, () => {
      fired.push("early-1");
    });
    clock.schedule(10, () => {
      fired.push("early-2");
    });

    await clock.advanceBy(9);
    expect(fired).toEqual([]);
    await clock.advanceBy(40);
    expect(fired).toEqual(["early-1", "early-2", "late"]);
  });

  it("does not fire cancelled timers", async () => {
    const clock = new ManualClock(new Date(0));
    const fired: number[] = [];
    const handle = clock.schedule(5, () => {
      fired.push(1);
    });
    clock.schedule(5, () => {
      fired.push(2);
    });

    clock.cancel(handle);
    await clock.advanceBy(10);
    expect(fired).toEqual([2]);
  });
});
