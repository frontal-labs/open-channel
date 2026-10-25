import { createTestHuman } from "@openchannel/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryTransport } from "../../src/directory/index.js";
import { googleDirectory } from "../../src/directory/index.js";

function createTransport(overrides: Partial<DirectoryTransport> = {}): DirectoryTransport {
  return {
    getActor: () => Promise.resolve(createTestHuman()),
    getGroupsForActor: () => Promise.resolve([]),
    searchActors: () => Promise.resolve([]),
    ...overrides,
  };
}

describe("ocp-sdk/directory", () => {
  it("caches directory identity lookups", async () => {
    let calls = 0;
    const provider = googleDirectory({
      transport: createTransport({
        getActor: () => {
          calls += 1;
          return Promise.resolve(createTestHuman());
        },
      }),
    });
    await provider.getActor("user:1");
    await provider.getActor("user:1");
    expect(calls).toBe(1);
  });

  describe("cache behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-fetches an actor once the TTL has elapsed", async () => {
      let calls = 0;
      const provider = googleDirectory({
        cacheTtlMs: 1000,
        transport: createTransport({
          getActor: () => {
            calls += 1;
            return Promise.resolve(createTestHuman());
          },
        }),
      });
      await provider.getActor("user:1");
      vi.advanceTimersByTime(999);
      await provider.getActor("user:1");
      expect(calls).toBe(1);
      vi.advanceTimersByTime(1);
      await provider.getActor("user:1");
      expect(calls).toBe(2);
    });

    it("keys actor and group lookups separately", async () => {
      const seen: string[] = [];
      const provider = googleDirectory({
        transport: createTransport({
          getActor: (externalId) => {
            seen.push(`actor:${externalId}`);
            return Promise.resolve(undefined);
          },
          getGroupsForActor: (actorId) => {
            seen.push(`groups:${actorId}`);
            return Promise.resolve(["group:admins"]);
          },
        }),
      });
      await provider.getActor("user:1");
      await provider.getActor("user:2");
      await provider.getGroupsForActor("user:1");
      await provider.getGroupsForActor("user:1");
      expect(seen).toEqual(["actor:user:1", "actor:user:2", "groups:user:1"]);
    });

    it("caches undefined actor lookups until the TTL elapses", async () => {
      let calls = 0;
      const provider = googleDirectory({
        transport: createTransport({
          getActor: () => {
            calls += 1;
            return Promise.resolve(undefined);
          },
        }),
      });
      expect(await provider.getActor("user:missing")).toBeUndefined();
      expect(await provider.getActor("user:missing")).toBeUndefined();
      expect(calls).toBe(1);
    });

    it("does not cache failed transport calls", async () => {
      let calls = 0;
      const provider = googleDirectory({
        transport: createTransport({
          getGroupsForActor: () => {
            calls += 1;
            return calls === 1 ? Promise.reject(new Error("throttled")) : Promise.resolve(["g"]);
          },
        }),
      });
      await expect(provider.getGroupsForActor("user:1")).rejects.toThrow("throttled");
      expect(await provider.getGroupsForActor("user:1")).toEqual(["g"]);
      expect(calls).toBe(2);
    });

    it("sends every search to the transport", async () => {
      let calls = 0;
      const provider = googleDirectory({
        transport: createTransport({
          searchActors: () => {
            calls += 1;
            return Promise.resolve([]);
          },
        }),
      });
      await provider.searchActors("ada");
      await provider.searchActors("ada");
      expect(calls).toBe(2);
    });
  });
});
