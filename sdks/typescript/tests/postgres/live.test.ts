import { randomUUID } from "node:crypto";
import { type EventEnvelope, eventType } from "ocp-protocol";
import { createTestEvent } from "ocp-testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  migratePostgresStore,
  type PostgresClient,
  postgresStore,
} from "../../src/postgres/index.js";

/**
 * Runs the store against a real PostgreSQL server. Set OCP_POSTGRES_URL to enable it, for example
 * `OCP_POSTGRES_URL=postgres://ocp@127.0.0.1:5432/postgres pnpm --filter ocp-sdk/postgres test`.
 * Each run creates its own schema and drops it afterwards, so existing tables are never touched.
 */
const url = process.env.OCP_POSTGRES_URL;

describe.skipIf(!url)("ocp-sdk/postgres against a live PostgreSQL server", () => {
  const schema = `ocp_test_${randomUUID().replaceAll("-", "")}`;
  let pool: pg.Pool;
  let client: PostgresClient;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({
      connectionString: url,
      max: 8,
      options: `-c search_path=${schema}`,
    });
    client = {
      query: (sql, values) =>
        pool.query(sql, values ? [...values] : undefined) as unknown as Promise<{
          rows: never[];
        }>,
    };
    await migratePostgresStore(client);
  });

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("appends, deduplicates, and reads events back", async () => {
    const store = postgresStore({ client });
    const event = createTestEvent({ eventId: "live-event-1", eventType: "message.received" });

    await store.append(event);
    expect(await store.has("live-event-1")).toBe(true);
    expect(await store.appendIfAbsent(event)).toBe(false);
    expect(eventType((await store.get("live-event-1")) as EventEnvelope)).toBe("message.received");
    expect(await store.query({ eventType: "message.received" })).toHaveLength(1);
    expect(await store.query({ eventType: "message.sent" })).toHaveLength(0);
  });

  it("refuses a second claim while the lease is live", async () => {
    const store = postgresStore({ client });

    expect(await store.claimAction("live-action-1", "worker-a")).toBe(true);
    expect(await store.claimAction("live-action-1", "worker-b")).toBe(false);
  });

  it("lets another worker take over an action whose lease has expired", async () => {
    const short = postgresStore({ client, leaseMs: 50 });

    expect(await short.claimAction("live-action-2", "worker-a")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await short.claimAction("live-action-2", "worker-b")).toBe(true);

    const owner = await client.query<{ owner: string }>(
      "SELECT owner FROM ocp_actions WHERE action_id = $1",
      ["live-action-2"],
    );
    expect(owner.rows[0]?.owner).toBe("worker-b");
  });

  it("never takes over a completed action, even after its lease would have expired", async () => {
    const short = postgresStore({ client, leaseMs: 50 });

    expect(await short.claimAction("live-action-3", "worker-a")).toBe(true);
    await short.completeAction("live-action-3", { ok: true });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await short.claimAction("live-action-3", "worker-b")).toBe(false);
    expect((await short.getAction("live-action-3"))?.status).toBe("completed");
  });

  it("lets exactly one of many concurrent claimants win an expired lease", async () => {
    // Plant a claim that expired an hour ago, then race ten workers for it with the default lease.
    await client.query(
      `INSERT INTO ocp_actions (action_id, owner, status, claimed_at)
       VALUES ($1, 'worker-dead', 'claimed', NOW() - INTERVAL '1 hour')`,
      ["live-action-4"],
    );
    const store = postgresStore({ client });
    const winners = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.claimAction("live-action-4", `worker-${index}`),
      ),
    );

    expect(winners.filter(Boolean)).toHaveLength(1);
  });
});
