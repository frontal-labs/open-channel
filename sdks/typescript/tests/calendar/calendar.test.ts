import { ActionError } from "@openchannelprotocol/core";
import { describe, expect, it } from "vitest";
import type { CalendarClient } from "../../src/calendar/index.js";
import { calendarActions } from "../../src/calendar/index.js";

/** Resolves to the rejection reason of `outcome`, or to `undefined` when it resolves. */
async function settle(outcome: unknown): Promise<unknown> {
  try {
    await outcome;
  } catch (caught) {
    return caught;
  }
  return undefined;
}

const context = { actor: {} as never, request: {} as never, runtime: {} as never };

function createClient(overrides: Partial<CalendarClient> = {}): CalendarClient {
  return {
    cancel: async () => ({ cancelled: true }),
    create: async (input) => ({
      end: input.end,
      externalId: "event:1",
      start: input.start,
      title: input.title,
    }),
    update: async () => ({ end: "end", externalId: "event:1", start: "start", title: "updated" }),
    ...overrides,
  };
}

describe("@openchannelprotocol/sdk/calendar", () => {
  it("creates SDK action definitions with Zod validation", () => {
    const actions = calendarActions({
      cancel: async () => ({ cancelled: true }),
      create: async (input) => ({
        end: input.end,
        externalId: "event:1",
        start: input.start,
        title: input.title,
      }),
      update: async () => ({ end: "end", externalId: "event:1", start: "start", title: "updated" }),
    });
    expect(actions.map((action) => action.type)).toEqual([
      "calendar.create",
      "calendar.update",
      "calendar.cancel",
    ]);
    expect(() => actions[0]?.validate?.({ end: "end", start: "start", title: "" })).toThrow();
  });

  it("rejects an event whose end is not after its start", () => {
    const [create, update] = calendarActions(createClient({}));
    expect(() =>
      create?.validate({
        end: "2026-10-23T10:00:00Z",
        start: "2026-10-23T11:00:00Z",
        title: "Sync",
      }),
    ).toThrow();
    expect(() =>
      update?.validate({
        end: "2026-10-23T09:00:00Z",
        eventId: "event:1",
        start: "2026-10-23T10:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts an update that changes only one of start or end", () => {
    const [, update] = calendarActions(createClient({}));
    expect(() =>
      update?.validate({ end: "2026-10-23T09:00:00Z", eventId: "event:1" }),
    ).not.toThrow();
  });

  it("strips unknown keys during validation before the client sees the input", async () => {
    let received: unknown;
    const [create] = calendarActions(
      createClient({
        create: (request) => {
          received = request;
          return Promise.resolve({
            end: request.end,
            externalId: "event:1",
            start: request.start,
            title: request.title,
          });
        },
      }),
    );
    const input = create?.validate({
      end: "2026-10-23T11:00:00Z",
      extra: "dropped",
      start: "2026-10-23T10:00:00Z",
      title: "Sync",
    });
    await create?.execute(input, context);
    expect(received).not.toHaveProperty("extra");
  });

  it("requires an eventId for update and cancel", () => {
    const [, update, cancel] = calendarActions(createClient());
    expect(() => update?.validate({ title: "Renamed" })).toThrow();
    expect(() => cancel?.validate({ reason: "no longer needed" })).toThrow();
  });

  it("wraps unclassified client failures as retryable calendar errors", async () => {
    const cause = new Error("socket reset");
    const [create] = calendarActions(
      createClient({
        create: () => Promise.reject(cause),
      }),
    );
    const error = await settle(create?.execute({ end: "e", start: "s", title: "t" }, context));
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({
      message: "Calendar event creation failed",
      provider: "calendar",
      retryable: true,
    });
    expect((error as ActionError).cause).toBe(cause);
  });

  it("passes through ActionErrors already classified by the client", async () => {
    const classified = new ActionError("Calendar quota exceeded", {
      provider: "google",
      retryable: false,
    });
    const [, , cancel] = calendarActions(
      createClient({
        cancel: () => Promise.reject(classified),
      }),
    );
    const error = await settle(cancel?.execute({ eventId: "event:1" }, context));
    expect(error).toBe(classified);
  });
});
