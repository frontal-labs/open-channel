import type { ActorRef } from "ocp-protocol";

/** Provider-neutral directory lookup port. */
export interface DirectoryProvider {
  /** Resolves a directory user or group by its external identifier. Returns `undefined` when no match exists. */
  getActor: (externalId: string) => Promise<ActorRef | undefined>;
  /** Lists the identifiers of the groups the actor belongs to. Empty when the actor has none. */
  getGroupsForActor: (actorId: string) => Promise<string[]>;
  /** Searches the directory by free text. Results are never cached. */
  searchActors: (query: string) => Promise<ActorRef[]>;
}

/**
 * External directory transport used by provider-specific factories. It has the same shape as
 * `DirectoryProvider`; the transport is the uncached, provider-specific implementation.
 */
export type DirectoryTransport = DirectoryProvider;

/** Options for a directory provider; `cacheTtlMs` sets how long lookups are cached. */
export interface DirectoryProviderOptions {
  /** Lifetime of a cached `getActor` or `getGroupsForActor` result, in milliseconds. Defaults to 60 000. */
  cacheTtlMs?: number;
  /** Uncached backend that performs the real lookups. */
  transport: DirectoryTransport;
}
