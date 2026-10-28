import type { ActorRef } from "@openchannelprotocol/protocol";
import type { DirectoryProvider, DirectoryProviderOptions, DirectoryTransport } from "./types.js";

/** One cached lookup. The promise is stored so concurrent callers share a single request. */
interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

/**
 * Caches `getActor` and `getGroupsForActor` results in memory for `cacheTtlMs`.
 *
 * Each cache is keyed by the exact argument string. Undefined actor lookups are cached too, so a
 * missing user is not re-queried until the TTL expires. Concurrent lookups for the same key share
 * one in-flight transport call. A failed call is removed from the cache, so the next lookup
 * retries it. Entries are never evicted by count, so memory grows with the number of distinct
 * keys looked up. `searchActors` always goes to the transport.
 */
export class CachedDirectoryProvider implements DirectoryProvider {
  private readonly actors = new Map<string, CacheEntry<ActorRef | undefined>>();
  private readonly groups = new Map<string, CacheEntry<string[]>>();
  private readonly ttlMs: number;
  private readonly transport: DirectoryTransport;

  constructor(options: DirectoryProviderOptions) {
    this.ttlMs = options.cacheTtlMs ?? 60_000;
    this.transport = options.transport;
  }

  getActor(externalId: string): Promise<ActorRef | undefined> {
    return this.cached(this.actors, externalId, () => this.transport.getActor(externalId));
  }

  getGroupsForActor(actorId: string): Promise<string[]> {
    return this.cached(this.groups, actorId, () => this.transport.getGroupsForActor(actorId));
  }

  searchActors(query: string): Promise<ActorRef[]> {
    return this.transport.searchActors(query);
  }

  private cached<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }
    const entry: CacheEntry<T> = { expiresAt: Date.now() + this.ttlMs, value: load() };
    cache.set(key, entry);
    entry.value.catch(() => {
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
    });
    return entry.value;
  }
}

/**
 * Creates a directory provider for Google Workspace. The caching behavior is the same as
 * `CachedDirectoryProvider`; the transport supplies all Google-specific lookups.
 */
export function googleDirectory(options: DirectoryProviderOptions): DirectoryProvider {
  return new CachedDirectoryProvider(options);
}

/**
 * Creates a directory provider for Microsoft Entra/Graph. The caching behavior is the same as
 * `CachedDirectoryProvider`; the transport supplies all Microsoft-specific lookups.
 */
export function microsoftDirectory(options: DirectoryProviderOptions): DirectoryProvider {
  return new CachedDirectoryProvider(options);
}
