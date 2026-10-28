import { ValidationError } from "@openchannelprotocol/core";
import { createTestEvent } from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";
import {
  migratePostgresStore,
  postgresEventStoreMigration,
  postgresStore,
} from "../../src/postgres/index.js";

function recordingClient() {
  const statements: string[] = [];
  return {
    client: {
      query: <TRow>(sql: string) => {
        statements.push(sql);
        return Promise.resolve({ rows: [] as TRow[] });
      },
    },
    statements,
  };
}

describe("@openchannelprotocol/sdk/postgres migration", () => {
  it("creates the table the store writes to when a custom table name is configured", async () => {
    const { client, statements } = recordingClient();
    await migratePostgresStore(client, { tableName: "orders_events" });
    const store = postgresStore({ client, tableName: "orders_events" });
    await store.append(createTestEvent({ eventId: "event:custom" }));

    const migration = statements[0] ?? "";
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS orders_events");
    expect(migration).toContain("orders_events_type_idx");
    expect(migration).not.toContain("ocp_events");
    expect(statements[1]).toContain("INSERT INTO orders_events");
  });

  it("defaults to ocp_events", () => {
    expect(postgresEventStoreMigration()).toContain("CREATE TABLE IF NOT EXISTS ocp_events");
  });

  it("rejects a table name that is not a plain identifier", async () => {
    const { client, statements } = recordingClient();
    expect(() => postgresEventStoreMigration("events; DROP TABLE users")).toThrow(ValidationError);
    await expect(
      migratePostgresStore(client, { tableName: "events; DROP TABLE users" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(statements).toHaveLength(0);
    expect(() => postgresStore({ client, tableName: "Bad-Name" })).toThrow(ValidationError);
  });
});
