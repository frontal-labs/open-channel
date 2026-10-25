import {
  createBufferedTestIO,
  createDeferred,
  createTestEvent,
  createTestRecorder,
  eventsOfType,
  eventTypes,
  findEvent,
  requireEvent,
  waitFor,
} from "ocp-testing";
import { describe, expect, it } from "vitest";

describe("OCP testing toolkit", () => {
  it("creates and inspects protocol events", () => {
    const events = [
      createTestEvent({ eventId: "one", eventType: "message.received" }),
      createTestEvent({ eventId: "two", eventType: "message.sent" }),
    ];

    expect(eventTypes(events)).toEqual(["message.received", "message.sent"]);
    expect(eventsOfType(events, "message.sent")).toHaveLength(1);
    expect(findEvent(events, "message.received")?.eventId).toBe("one");
    expect(requireEvent(events, "message.sent").eventId).toBe("two");
  });

  it("coordinates async work, records values, and buffers CLI I/O", async () => {
    const deferred = createDeferred<string>();
    const recorder = createTestRecorder<number>();
    const buffered = createBufferedTestIO("input");
    let ready = false;

    recorder.record(1);
    setTimeout(() => {
      ready = true;
      deferred.resolve("done");
    }, 1);
    await waitFor(() => ready);

    expect(await deferred.promise).toBe("done");
    expect(recorder.values).toEqual([1]);
    expect(await buffered.io.readStdin()).toBe("input");
    buffered.io.stdout("ok");
    buffered.io.stderr("warning");
    expect(buffered.stdout).toEqual(["ok"]);
    expect(buffered.stderr).toEqual(["warning"]);
  });
});
