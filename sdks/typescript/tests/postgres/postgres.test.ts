import { createTestEvent } from "@openchannel/testing";
import { describe, expect, it } from "vitest";
import { postgresStore } from "../../src/postgres/index.js";

describe("ocp-sdk/postgres", () => {
  it("uses appendIfAbsent for runtime idempotency", async () => {
    let inserted = false;
    const store = postgresStore({
      client: {
        query: <TRow>(sql: string) => {
          if (sql.includes("RETURNING event_id")) {
            if (inserted) {
              return Promise.resolve({ rows: [] as TRow[] });
            }
            inserted = true;
            return Promise.resolve({ rows: [{ event_id: "event:1" }] as TRow[] });
          }
          return Promise.resolve({ rows: [] as TRow[] });
        },
      },
    });
    const event = createTestEvent({ eventId: "event:1" });
    expect(await store.appendIfAbsent(event)).toBe(true);
    expect(await store.appendIfAbsent(event)).toBe(false);
  });

  it("binds every event value as a parameter and never inlines it into SQL", async () => {
    const calls: { sql: string; values: readonly unknown[] | undefined }[] = [];
    const store = postgresStore({
      client: {
        query: <TRow>(sql: string, values?: readonly unknown[]) => {
          calls.push({ sql, values });
          return Promise.resolve({ rows: [] as TRow[] });
        },
      },
    });
    await store.append(createTestEvent({ eventId: "event:'; DROP TABLE x; --" }));

    expect(calls[0]?.sql).not.toContain("DROP TABLE");
    expect(calls[0]?.values?.[0]).toBe("event:'; DROP TABLE x; --");
  });

  it("falls back to the default limit when list receives a non-finite limit", async () => {
    const calls: { values: readonly unknown[] | undefined }[] = [];
    const store = postgresStore({
      client: {
        query: <TRow>(_sql: string, values?: readonly unknown[]) => {
          calls.push({ values });
          return Promise.resolve({ rows: [] as TRow[] });
        },
      },
    });
    await store.list({ limit: Number.NaN });
    await store.list({ limit: 2.9 });
    await store.list({ eventType: "message.received" });

    expect(calls.map((call) => call.values?.at(-1))).toEqual([10_000, 2, 10_000]);
  });
});
