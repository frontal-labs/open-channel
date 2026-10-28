import { ValidationError } from "@openchannelprotocol/core";
import { type EventEnvelope, eventType, fromJson, toJson } from "@openchannelprotocol/protocol";
import type { ActionExecutionRecord, EventStore } from "@openchannelprotocol/runtime";

import type {
  PostgresClient,
  PostgresEventRow,
  PostgresEventStoreOptions,
  PostgresQueryResult,
} from "./types.js";

const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/u;
const DEFAULT_TABLE_NAME = "ocp_events";
/** Default time before a claimed action can be taken over: five minutes. */
const DEFAULT_ACTION_LEASE_MS = 5 * 60_000;
/** Row limit for `list` and `query` when the caller gives none. */
const DEFAULT_LIST_LIMIT = 10_000;
/** Effectively unbounded row limit used by `all`. */
const UNBOUNDED_LIMIT = 10_000_000;
const EVENT_COLUMNS =
  "event_id, event_type, protocol_version, occurred_at, correlation_id, causation_id, idempotency_key, event_json";

/**
 * Returns the SQL migration for the event table and the action-state table.
 *
 * The migration is idempotent (`IF NOT EXISTS`), so it can run on every start. `tableName` is
 * checked against a plain-identifier pattern before it is interpolated, and index names derive
 * from it. The `ocp_actions` table is fixed and shared by every store.
 */
export function postgresEventStoreMigration(tableName = DEFAULT_TABLE_NAME): string {
  const table = validatedTableName(tableName);
  return `
CREATE TABLE IF NOT EXISTS ${table} (
  sequence BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL DEFAULT '',
  causation_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  event_json JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ${table}_type_idx ON ${table} (event_type, sequence);
CREATE INDEX IF NOT EXISTS ${table}_correlation_idx ON ${table} (correlation_id, sequence);
CREATE INDEX IF NOT EXISTS ${table}_idempotency_idx ON ${table} (idempotency_key);
CREATE TABLE IF NOT EXISTS ocp_actions (
  action_id TEXT PRIMARY KEY,
  owner TEXT,
  status TEXT NOT NULL,
  result_json JSONB,
  error_json JSONB,
  claimed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ocp_actions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
`;
}

/** Migration for the default `ocp_events` table. Equal to `postgresEventStoreMigration()`. */
export const POSTGRES_EVENT_STORE_MIGRATION = postgresEventStoreMigration();

function validatedTableName(value: string): string {
  if (!TABLE_NAME_PATTERN.test(value)) {
    throw new ValidationError(`Invalid PostgreSQL table name: ${value}`, {
      provider: "postgres",
      stage: "validation",
    });
  }
  return value;
}

/** Converts a stored row back to an envelope. `event_json` is a JSONB object or, in some drivers, text. */
function decode(row: PostgresEventRow): EventEnvelope {
  const value = typeof row.event_json === "string" ? JSON.parse(row.event_json) : row.event_json;
  return fromJson(value);
}

/** Uses the event's own timestamp, falling back to the local clock when it has none. */
function occurredAtOf(event: EventEnvelope): Date {
  return event.occurredAt
    ? new Date(Number(event.occurredAt.seconds) * 1000 + event.occurredAt.nanos / 1_000_000)
    : new Date();
}

/**
 * Durable EventStore backed by an injected PostgreSQL client.
 *
 * Every value is passed as a bound parameter. Events are keyed by `eventId`, so appending the
 * same event twice stores it once. The store is append-only and has no update or delete.
 */
export class PostgresEventStore implements EventStore {
  private readonly client: PostgresClient;
  private readonly table: string;
  private readonly leaseMs: number;

  constructor(options: PostgresEventStoreOptions) {
    this.client = options.client;
    this.table = validatedTableName(options.tableName ?? DEFAULT_TABLE_NAME);
    const leaseMs = options.leaseMs ?? DEFAULT_ACTION_LEASE_MS;
    if (!Number.isInteger(leaseMs) || leaseMs < 0) {
      throw new ValidationError(
        "PostgreSQL action lease must be a non-negative whole number of milliseconds",
        {
          provider: "postgres",
          stage: "validation",
        },
      );
    }
    this.leaseMs = leaseMs;
  }

  /** Stores the event. A duplicate `eventId` is silently ignored. Use `appendIfAbsent` to learn which case happened. */
  async append(event: EventEnvelope): Promise<void> {
    await this.insertEvent(event);
  }

  /** Stores the event and resolves to `true`, or to `false` when an event with the same `eventId` already exists. */
  async appendIfAbsent(event: EventEnvelope): Promise<boolean> {
    const result = await this.insertEvent(event);
    return result.rows.length > 0;
  }

  async has(eventId: string): Promise<boolean> {
    const result = await this.client.query<{ event_id: string }>(
      `SELECT event_id FROM ${this.table} WHERE event_id = $1 LIMIT 1`,
      [eventId],
    );
    return result.rows.length > 0;
  }

  async get(eventId: string): Promise<EventEnvelope | undefined> {
    const result = await this.client.query<PostgresEventRow>(
      `SELECT ${EVENT_COLUMNS} FROM ${this.table} WHERE event_id = $1 LIMIT 1`,
      [eventId],
    );
    const [row] = result.rows;
    return row ? decode(row) : undefined;
  }

  /**
   * Returns events in append order, optionally filtered by type. `limit` defaults to 10,000.
   * A negative limit returns nothing, and a non-finite one (NaN, Infinity) falls back to the default.
   */
  async list(options: { eventType?: string; limit?: number } = {}): Promise<EventEnvelope[]> {
    const values: unknown[] = [];
    const filters: string[] = [];
    if (options.eventType) {
      values.push(options.eventType);
      filters.push(`event_type = $${values.length}`);
    }
    const requested = options.limit ?? DEFAULT_LIST_LIMIT;
    const limit = Number.isFinite(requested)
      ? Math.max(0, Math.floor(requested))
      : DEFAULT_LIST_LIMIT;
    values.push(limit);
    const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const result = await this.client.query<PostgresEventRow>(
      `SELECT ${EVENT_COLUMNS} FROM ${this.table}${where}
       ORDER BY sequence ASC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(decode);
  }

  /** Returns every stored event, up to ten million rows. Prefer `list` with a limit for large tables. */
  all(): Promise<EventEnvelope[]> {
    return this.list({ limit: UNBOUNDED_LIMIT });
  }

  /** Same as `list`. Provided for runtime code that calls `query`. */
  query(options: { eventType?: string; limit?: number } = {}): Promise<EventEnvelope[]> {
    return this.list(options);
  }

  /**
   * Claims an action for `owner`. A new claim always succeeds. An existing claim is taken over
   * only when it is still `claimed` and its lease has expired. The check and the takeover are a
   * single statement, so two workers cannot both win the same expired lease.
   */
  async claimAction(actionId: string, owner: string): Promise<boolean> {
    const result = await this.client.query<{ action_id: string }>(
      `INSERT INTO ocp_actions (action_id, owner, status, claimed_at)
       VALUES ($1, $2, 'claimed', NOW())
       ON CONFLICT (action_id) DO UPDATE
         SET owner = EXCLUDED.owner, claimed_at = NOW(), updated_at = NOW()
         WHERE ocp_actions.status = 'claimed'
           AND COALESCE(ocp_actions.claimed_at, ocp_actions.updated_at)
               < NOW() - ($3::bigint * INTERVAL '1 millisecond')
       RETURNING action_id`,
      [actionId, owner, this.leaseMs],
    );
    return result.rows.length > 0;
  }

  /** Marks the action completed and stores its result. Does not check the owner or the current status. */
  async completeAction(actionId: string, result: unknown): Promise<void> {
    await this.client.query(
      `UPDATE ocp_actions SET status = 'completed', result_json = $2::jsonb, updated_at = NOW()
       WHERE action_id = $1`,
      [actionId, JSON.stringify(result)],
    );
  }

  /** Marks the action failed and stores the error. Does not check the owner or the current status. */
  async failAction(actionId: string, error: unknown): Promise<void> {
    await this.client.query(
      `UPDATE ocp_actions SET status = 'failed', error_json = $2::jsonb, updated_at = NOW()
       WHERE action_id = $1`,
      [actionId, JSON.stringify(error)],
    );
  }

  async getAction(actionId: string): Promise<ActionExecutionRecord | undefined> {
    const result = await this.client.query<{
      action_id: string;
      error_json: unknown;
      owner: string | null;
      result_json: unknown;
      status: ActionExecutionRecord["status"];
    }>(
      "SELECT action_id, owner, status, result_json, error_json FROM ocp_actions WHERE action_id = $1",
      [actionId],
    );
    const [row] = result.rows;
    return row
      ? {
          actionId: row.action_id,
          error: row.error_json ?? undefined,
          owner: row.owner ?? undefined,
          result: row.result_json ?? undefined,
          status: row.status,
        }
      : undefined;
  }

  /** Inserts the event. The statement returns a row only when the insert happened. */
  private insertEvent(event: EventEnvelope): Promise<PostgresQueryResult<{ event_id: string }>> {
    return this.client.query<{ event_id: string }>(
      `INSERT INTO ${this.table} (event_id, event_type, protocol_version, occurred_at, correlation_id, causation_id, idempotency_key, event_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.eventId,
        eventType(event),
        event.protocolVersion,
        occurredAtOf(event),
        event.correlationId,
        event.causationId,
        event.idempotencyKey,
        JSON.stringify(toJson(event)),
      ],
    );
  }
}

/**
 * Runs the event-store migration with the given client. Safe to run more than once. Running it
 * from several processes at the same moment can still race on the first `CREATE`, so run it once
 * during deployment.
 */
export async function migratePostgresStore(
  client: PostgresClient,
  options: { tableName?: string } = {},
): Promise<void> {
  await client.query(postgresEventStoreMigration(options.tableName));
}

/** Creates a runtime-compatible PostgreSQL EventStore. Equivalent to `new PostgresEventStore(options)`. */
export function postgresStore(options: PostgresEventStoreOptions): PostgresEventStore {
  return new PostgresEventStore(options);
}
