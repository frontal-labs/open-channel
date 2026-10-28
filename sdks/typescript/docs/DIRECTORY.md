# @openchannelprotocol/sdk/directory

Cached directory lookups for OCP agents. Channels and policy often need to turn an external user
ID into an OCP actor, or ask which groups a person belongs to. This package wraps a provider
directory transport with an in-memory TTL cache, so repeated lookups do not call the directory API
every time.

## Where it sits in the OCP flow

```text
provider input (sender ID) -> directory lookup (this package, cached) -> actor / groups
  -> OCP message.received with an actor -> harness -> message.sent -> provider output
```

The package does not reach the network itself. The host supplies a `DirectoryTransport` that calls
the real directory (Google Workspace, Microsoft Entra/Graph, or anything else).

## Install

```sh
pnpm add @openchannelprotocol/sdk
```

## Quickstart

```ts
import { googleDirectory } from "@openchannelprotocol/sdk/directory";

const directory = googleDirectory({
  cacheTtlMs: 5 * 60_000,
  transport: {
    // Replace these stubs with calls to the Google Admin SDK (or your directory API).
    getActor: async () => undefined,
    getGroupsForActor: async () => [],
    searchActors: async () => [],
  },
});

const actor = await directory.getActor("user-123");
const groups = await directory.getGroupsForActor("user-123");
```

Pass `directory.getActor` to a channel's `actorResolver` to attach a directory identity to inbound
senders.

## Caching behavior

- Lookups are cached per exact argument for `cacheTtlMs` (default 60 000 ms).
- Undefined results (no such user) are cached too, so a missing user is not re-queried until the TTL
  expires.
- Concurrent lookups for the same key share one in-flight call.
- Failed calls are not cached. The next lookup retries.
- `searchActors` always goes to the transport and is never cached.
- Entries are never evicted by count, so memory grows with the number of distinct keys looked up.
  Keep the TTL short for long-running processes with many distinct users.

## Safety boundary

The directory answers identity questions; it does not authorize anything. Policy decisions still
come from the policy engine. Do not treat "the directory returned a group" as permission to run an
action.

## Environment

The package reads no environment variables. Your transport supplies its own credentials (for example
a service account for Google or an app registration for Microsoft).

## Tests

```sh
pnpm --filter @openchannelprotocol/sdk test
```

The tests use an in-memory transport and do not need credentials.
