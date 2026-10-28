# @openchannelprotocol/sdk/postgres

A durable PostgreSQL `EventStore` for OCP. It keeps every event in an append-only table, records
action state for safe retries, and ships an idempotent migration. Use it wherever the in-memory test
store would lose data on restart.

## Where it sits in the OCP flow

```text
OCP message.received / message.sent / action events -> PostgresEventStore (this package)
  -> replay, audit, and action leases on restart
```

## Install

```sh
pnpm add @openchannelprotocol/sdk pg
```

`pg` is not a dependency of this package. Pass your own client or pool, so you control the connection
settings and pool size.

## Setup

1. Create a database and a role with `CREATE` privileges on the schema.
2. Run the migration once during deployment. It is idempotent, so running it again is harmless.
3. Pass the pool to the store.

```ts
import { migratePostgresStore, postgresStore } from "@openchannelprotocol/sdk/postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

await migratePostgresStore(pool);
const store = postgresStore({ client: pool });
```

Pass `store` as `openChannel({ store })`. Run the migration from one process at deploy time. Several
processes migrating at the same moment can race on the first `CREATE`.

## Quickstart

```ts
import { postgresStore, migratePostgresStore } from "@openchannelprotocol/sdk/postgres";
import { RuleBasedPolicyEngine } from "@openchannelprotocol/sdk";
import { Pool } from "pg";
import { openChannel } from "@openchannelprotocol/sdk";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migratePostgresStore(pool);

const app = openChannel({
  channels: [],
  policy: new RuleBasedPolicyEngine({ rules: [] }),
  store: postgresStore({ client: pool }),
});
```

## Options

- `client` (required): any object with `query(sql, values)` that resolves to `{ rows }`. `pg.Pool` fits.
- `tableName`: event table name. Must match `[a-z_][a-z0-9_]*`. Defaults to `ocp_events`. Run the
  migration with the same name.
- `leaseMs`: how long a claimed action may stay in progress before another worker can take it over.
  Defaults to five minutes. Completed and failed actions are never taken over.

## Guarantees

- Every value is a bound parameter. The only interpolated text is the validated table name.
- Events are keyed by `eventId`. Appending the same event twice stores it once.
- The store is append-only. There is no update or delete for events.
- Action claims are atomic. Two workers cannot both win the same expired lease.
- `completeAction` and `failAction` do not check the owner. Only the worker that claimed an action
  should call them.

## Environment

- `DATABASE_URL` (in the example above): the connection string your application passes to `pg`.
- `OCP_POSTGRES_URL`: enables the live tests (see below). Point it at a disposable database, because
  the tests create and write tables.

## Tests

```sh
pnpm --filter @openchannelprotocol/sdk test
```

Without `OCP_POSTGRES_URL`, the live tests are skipped and the unit tests still run. To run the live
tests:

```sh
OCP_POSTGRES_URL=postgres://user:pass@localhost:5432/ocp_test \
  pnpm --filter @openchannelprotocol/sdk test
```
