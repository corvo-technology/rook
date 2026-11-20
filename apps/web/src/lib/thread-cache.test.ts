import type { ThreadMessage, ThreadSnapshot } from "@corvo/contracts";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheableSnapshot,
  createThreadCache,
  indexedDbThreadCacheStore,
  THREAD_CACHE_LIMITS,
  type ThreadCacheStore,
} from "./thread-cache";

type Meta = Parameters<ThreadCacheStore["put"]>[0];

/** The store's contract over maps, so the cache's rules are checked without a browser. */
function memoryStore() {
  const metas = new Map<string, Meta>();
  const snapshots = new Map<string, ThreadSnapshot>();
  const store: ThreadCacheStore = {
    get: async (key) => snapshots.get(key),
    put: async (meta, snapshot, evict) => {
      metas.set(meta.key, meta);
      snapshots.set(meta.key, snapshot);
      for (const key of evict) {
        metas.delete(key);
        snapshots.delete(key);
      }
    },
    touch: async (key, usedAt) => {
      const meta = metas.get(key);
      if (meta) metas.set(key, { ...meta, usedAt });
    },
    metas: async () => [...metas.values()],
    clear: async () => {
      metas.clear();
      snapshots.clear();
    },
  };
  return { store, metas, snapshots };
}

const scope = { userId: "user-1", spaceId: "space-1" };

function message(seq: number, blocks: ThreadMessage["blocks"], chars = 0): ThreadMessage {
  return {
    id: `m-${seq}`,
    threadId: "thread-1",
    seq,
    role: "bot",
    blocks: chars ? [{ kind: "text", text: "x".repeat(chars) }, ...blocks] : blocks,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function snapshot(messages: ThreadMessage[], extra: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    threadId: "thread-1",
    cursor: 40,
    messages,
    olderCursor: null,
    botId: "bot-1",
    run: { id: "run-1", status: "running" } as ThreadSnapshot["run"],
    activeRuns: [{ id: "run-1", status: "running" } as never],
    computer: { botId: "bot-1" } as never,
    ...extra,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function settle() {
  await vi.advanceTimersByTimeAsync(1_000);
}

describe("thread cache", () => {
  it("returns what was saved, once the write has had its moment", async () => {
    const { store } = memoryStore();
    const cache = createThreadCache(store);
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [{ kind: "text", text: "hi" }])]));
    expect(await cache.read(scope, { botId: "bot-1" })).toBeUndefined();
    await settle();
    const cached = await cache.read(scope, { botId: "bot-1" });
    expect(cached?.messages.map((m) => m.id)).toEqual(["m-1"]);
  });

  it("writes a burst of saves once, with the newest", async () => {
    const memory = memoryStore();
    const put = vi.spyOn(memory.store, "put");
    const cache = createThreadCache(memory.store);
    for (let seq = 1; seq <= 5; seq++) {
      cache.save(scope, { botId: "bot-1" }, snapshot([message(seq, [])], { cursor: seq }));
    }
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    expect((await cache.read(scope, { botId: "bot-1" }))?.cursor).toBe(5);
  });

  it("keeps each chat apart, by person, space and chat", async () => {
    const { store } = memoryStore();
    const cache = createThreadCache(store);
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [])]));
    await settle();
    expect(await cache.read({ ...scope, spaceId: "space-2" }, { botId: "bot-1" })).toBeUndefined();
    expect(await cache.read({ ...scope, userId: "user-2" }, { botId: "bot-1" })).toBeUndefined();
    expect(await cache.read(scope, { botId: "bot-2" })).toBeUndefined();
    expect(await cache.read(scope, { groupId: "bot-1" })).toBeUndefined();
  });

  it("leaves out run and computer state, which only the server knows", () => {
    const kept = cacheableSnapshot(snapshot([message(1, [])]));
    expect(kept.run).toBeNull();
    expect(kept).not.toHaveProperty("activeRuns");
    expect(kept).not.toHaveProperty("computer");
  });

  it("never keeps a secret, a credential destination or an endpoint's token", async () => {
    const { store, snapshots } = memoryStore();
    const cache = createThreadCache(store);
    cache.save(
      scope,
      { botId: "bot-1" },
      snapshot([
        message(1, [
          {
            kind: "ask",
            text: "Paste the key",
            input: "secret",
            answer: "sk-live-answer-123",
            credential: {
              kind: "header",
              name: "authorization",
              origin: "https://api.example.test",
            },
          } as never,
          {
            kind: "mcp_approval",
            name: "Tools",
            serverId: "srv-1",
            transport: "http",
            endpoint: "https://mcp.example.test/?token=abc123",
            needsOAuth: false,
            status: "pending",
          } as never,
        ]),
      ]),
    );
    await settle();
    const stored = JSON.stringify([...snapshots.values()]);
    expect(stored).not.toContain("sk-live-answer-123");
    expect(stored).not.toContain("api.example.test");
    expect(stored).not.toContain("abc123");
    expect(stored).toContain("Paste the key");
  });

  it("keeps the newest messages when an entry is over its budget, and says there are older ones", () => {
    const messages = Array.from({ length: 40 }, (_, seq) =>
      message(seq + 1, [], Math.floor(THREAD_CACHE_LIMITS.entryBytes / 10)),
    );
    const kept = cacheableSnapshot(snapshot(messages));
    expect(kept.messages.length).toBeLessThan(40);
    expect(kept.messages.at(-1)?.seq).toBe(40);
    expect(kept.olderCursor).toBe(kept.messages[0]?.seq);
    expect(new TextEncoder().encode(JSON.stringify(kept)).length).toBeLessThanOrEqual(
      THREAD_CACHE_LIMITS.entryBytes,
    );
  });

  it("evicts the least recently used chats beyond the count limit", async () => {
    const { store, metas } = memoryStore();
    const cache = createThreadCache(store);
    for (let index = 0; index < THREAD_CACHE_LIMITS.threads + 3; index++) {
      cache.save(
        scope,
        { botId: `bot-${index}` },
        snapshot([message(1, [])], { botId: `bot-${index}` }),
      );
      await settle();
    }
    expect(metas.size).toBe(THREAD_CACHE_LIMITS.threads);
    expect(await cache.read(scope, { botId: "bot-0" })).toBeUndefined();
    expect(
      await cache.read(scope, { botId: `bot-${THREAD_CACHE_LIMITS.threads + 2}` }),
    ).toBeDefined();
  });

  it("counts a read as a use, so the chat you keep opening stays", async () => {
    const { store, metas } = memoryStore();
    const cache = createThreadCache(store);
    cache.save(scope, { botId: "bot-0" }, snapshot([message(1, [])]));
    await settle();
    for (let index = 1; index < THREAD_CACHE_LIMITS.threads; index++) {
      cache.save(scope, { botId: `bot-${index}` }, snapshot([message(1, [])]));
      await settle();
    }
    await cache.read(scope, { botId: "bot-0" });
    cache.save(scope, { botId: "extra" }, snapshot([message(1, [])]));
    await settle();
    expect(metas.size).toBe(THREAD_CACHE_LIMITS.threads);
    expect(await cache.read(scope, { botId: "bot-0" })).toBeDefined();
    expect(await cache.read(scope, { botId: "bot-1" })).toBeUndefined();
  });

  it("evicts to stay under the total byte budget", async () => {
    const { store, metas } = memoryStore();
    const cache = createThreadCache(store);
    const size = Math.floor(THREAD_CACHE_LIMITS.entryBytes * 0.9);
    for (let index = 0; index < 18; index++) {
      cache.save(scope, { botId: `bot-${index}` }, snapshot([message(1, [], size)]));
      await settle();
    }
    const total = [...metas.values()].reduce((sum, meta) => sum + meta.bytes, 0);
    expect(total).toBeLessThanOrEqual(THREAD_CACHE_LIMITS.totalBytes);
    expect(metas.size).toBeGreaterThan(1);
    expect(metas.size).toBeLessThan(18);
  });

  it("drops another person's entries the next time anything is written", async () => {
    const { store, metas } = memoryStore();
    const cache = createThreadCache(store);
    cache.save(
      { userId: "user-0", spaceId: "space-1" },
      { botId: "bot-1" },
      snapshot([message(1, [])]),
    );
    await settle();
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [])]));
    await settle();
    expect([...metas.values()].map((meta) => meta.userId)).toEqual(["user-1"]);
  });

  it("forgets everything on sign-out, including a write still waiting", async () => {
    const { store, metas, snapshots } = memoryStore();
    const cache = createThreadCache(store);
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [])]));
    await settle();
    cache.save(scope, { botId: "bot-2" }, snapshot([message(1, [])]));
    await cache.clear();
    await settle();
    expect(metas.size).toBe(0);
    expect(snapshots.size).toBe(0);
    expect(await cache.read(scope, { botId: "bot-1" })).toBeUndefined();
  });

  it("does not write a snapshot whose write was queued before the wipe", async () => {
    const memory = memoryStore();
    let releaseMetas: () => void = () => undefined;
    const slow = memory.store.metas;
    memory.store.metas = () =>
      new Promise((resolve) => {
        releaseMetas = () => resolve(slow());
      });
    const cache = createThreadCache(memory.store);
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [])]));
    await vi.advanceTimersByTimeAsync(1_000);
    const cleared = cache.clear();
    releaseMetas();
    await cleared;
    await settle();
    expect(memory.snapshots.size).toBe(0);
  });

  it("is only a cache: a store that fails is not an error", async () => {
    const failing: ThreadCacheStore = {
      get: async () => {
        throw new Error("blocked");
      },
      put: async () => {
        throw new Error("quota");
      },
      touch: async () => {
        throw new Error("blocked");
      },
      metas: async () => {
        throw new Error("blocked");
      },
      clear: async () => {
        throw new Error("blocked");
      },
    };
    const cache = createThreadCache(failing);
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [])]));
    await settle();
    expect(await cache.read(scope, { botId: "bot-1" })).toBeUndefined();
    await expect(cache.clear()).resolves.toBeUndefined();
  });
});

describe("thread cache in IndexedDB", () => {
  beforeEach(() => vi.useRealTimers());
  const realSettle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("round-trips an entry and wipes it with clear", async () => {
    const store = indexedDbThreadCacheStore(new IDBFactory());
    const cache = createThreadCache(store, { saveDelayMs: 0 });
    cache.save(scope, { botId: "bot-1" }, snapshot([message(1, [{ kind: "text", text: "hi" }])]));
    await realSettle();
    const cached = await cache.read(scope, { botId: "bot-1" });
    expect(cached?.messages[0]?.blocks).toEqual([{ kind: "text", text: "hi" }]);
    expect(await store.metas()).toHaveLength(1);
    await cache.clear();
    expect(await cache.read(scope, { botId: "bot-1" })).toBeUndefined();
    expect(await store.metas()).toHaveLength(0);
  });

  it("evicts in the same step as the write", async () => {
    const store = indexedDbThreadCacheStore(new IDBFactory());
    const cache = createThreadCache(store, { saveDelayMs: 0 });
    for (let index = 0; index < THREAD_CACHE_LIMITS.threads + 2; index++) {
      cache.save(scope, { botId: `bot-${index}` }, snapshot([message(1, [])]));
      await realSettle();
    }
    expect(await store.metas()).toHaveLength(THREAD_CACHE_LIMITS.threads);
    expect(await cache.read(scope, { botId: "bot-0" })).toBeUndefined();
  });
});
