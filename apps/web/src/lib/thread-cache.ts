import type { MessageBlock, ThreadMessage, ThreadSnapshot } from "@corvo/contracts";

/** Few enough chats, each small enough, that the cache never grows into a second copy of the server. */
export const THREAD_CACHE_LIMITS = {
  threads: 20,
  totalBytes: 6 * 1024 * 1024,
  entryBytes: 384 * 1024,
} as const;

/** How long a burst of refreshes waits before the newest snapshot is written. */
const SAVE_DELAY_MS = 750;

export interface ThreadCacheScope {
  userId: string;
  spaceId: string;
}
export type ThreadCacheTarget = { botId: string } | { groupId: string };

interface Meta {
  key: string;
  userId: string;
  bytes: number;
  usedAt: number;
}

/** Where entries live. IndexedDB in the app; a map in tests. */
export interface ThreadCacheStore {
  get(key: string): Promise<ThreadSnapshot | undefined>;
  /** Writes the entry, then drops every entry in `evict`, in one step. */
  put(meta: Meta, snapshot: ThreadSnapshot, evict: string[]): Promise<void>;
  touch(key: string, usedAt: number): Promise<void>;
  metas(): Promise<Meta[]>;
  clear(): Promise<void>;
}

function keyOf(scope: ThreadCacheScope, target: ThreadCacheTarget): string {
  const chat = "botId" in target ? `bot:${target.botId}` : `group:${target.groupId}`;
  return JSON.stringify([scope.userId, scope.spaceId, chat]);
}

/**
 * The block as it may sit on disk. The cache is a first frame for a chat, so anything a person
 * answers with or a server would seal for them stays out: a secret card keeps its question and
 * loses what was typed into it and the destination it was for, and an MCP approval loses the
 * endpoint it would connect to, which may carry a token in its URL.
 */
function scrubBlock(block: MessageBlock): MessageBlock {
  if (block.kind === "ask") {
    const { credential: _credential, ...rest } = block;
    return rest.input === "secret" ? { ...rest, answer: undefined } : rest;
  }
  if (block.kind === "mcp_approval") return { ...block, endpoint: null };
  return block;
}

function scrubMessage(message: ThreadMessage): ThreadMessage {
  return { ...message, blocks: message.blocks.map(scrubBlock) };
}

const encoder = new TextEncoder();
const bytesOf = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

/**
 * What of a snapshot is kept: the messages, scrubbed, and the chat's identity. Run and computer
 * state describe the moment it was read, so they are left out and come from the server; the newest
 * messages that fit the entry budget are kept, and the cursor to older ones stays truthful.
 */
export function cacheableSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
  const { computer: _computer, activeRuns: _activeRuns, ...rest } = snapshot;
  let messages = snapshot.messages.map(scrubMessage);
  let olderCursor = snapshot.olderCursor;
  const shell = { ...rest, run: null, olderCursor };
  let size = bytesOf({ ...shell, messages });
  while (size > THREAD_CACHE_LIMITS.entryBytes && messages.length > 1) {
    const drop = Math.max(1, Math.floor(messages.length / 4));
    messages = messages.slice(drop);
    olderCursor = messages[0]?.seq ?? olderCursor;
    size = bytesOf({ ...shell, olderCursor, messages });
  }
  return { ...shell, olderCursor, messages };
}

/** The keys to drop so the rest fit the limits, newest use first, never dropping `keep`. */
function evictions(metas: Meta[], keep: string): string[] {
  const ordered = [...metas].sort((a, b) =>
    a.key === keep ? -1 : b.key === keep ? 1 : b.usedAt - a.usedAt,
  );
  const dropped: string[] = [];
  let bytes = 0;
  ordered.forEach((meta, index) => {
    bytes += meta.bytes;
    if (
      index >= THREAD_CACHE_LIMITS.threads ||
      (index > 0 && bytes > THREAD_CACHE_LIMITS.totalBytes)
    ) {
      dropped.push(meta.key);
      bytes -= meta.bytes;
    }
  });
  return dropped;
}

export function createThreadCache(
  store: ThreadCacheStore,
  {
    now = Date.now,
    saveDelayMs = SAVE_DELAY_MS,
  }: { now?: () => number; saveDelayMs?: number } = {},
) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  // Writes and the wipe run one after another, and a write queued before a wipe is dropped, so a
  // chat read just before sign-out cannot land on disk after it.
  let epoch = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work, work);
    return queue;
  };

  function write(scope: ThreadCacheScope, target: ThreadCacheTarget, snapshot: ThreadSnapshot) {
    const queuedAt = epoch;
    return enqueue(async () => {
      if (queuedAt !== epoch) return;
      await writeNow(scope, target, snapshot);
    });
  }

  async function writeNow(
    scope: ThreadCacheScope,
    target: ThreadCacheTarget,
    snapshot: ThreadSnapshot,
  ) {
    try {
      const key = keyOf(scope, target);
      const entry = cacheableSnapshot(snapshot);
      const meta: Meta = { key, userId: scope.userId, bytes: bytesOf(entry), usedAt: now() };
      const others = (await store.metas()).filter((existing) => existing.key !== key);
      // Entries of another account are never kept, whoever wrote them.
      const foreign = others.filter((existing) => existing.userId !== scope.userId);
      const mine = others.filter((existing) => existing.userId === scope.userId);
      await store.put(meta, entry, [
        ...foreign.map((existing) => existing.key),
        ...evictions([...mine, meta], key),
      ]);
    } catch {
      // The cache only speeds things up; a full disk or a blocked database is not an error.
    }
  }

  return {
    /** The chat as last cached for this person in this space, or nothing. */
    async read(scope: ThreadCacheScope, target: ThreadCacheTarget) {
      try {
        const key = keyOf(scope, target);
        const snapshot = await store.get(key);
        if (snapshot) void store.touch(key, now()).catch(() => undefined);
        return snapshot;
      } catch {
        return undefined;
      }
    },
    /** Remembers the chat soon; a burst of refreshes writes once, with the newest. */
    save(scope: ThreadCacheScope, target: ThreadCacheTarget, snapshot: ThreadSnapshot) {
      const key = keyOf(scope, target);
      const waiting = pending.get(key);
      if (waiting) clearTimeout(waiting);
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          void write(scope, target, snapshot);
        }, saveDelayMs),
      );
    },
    /** Sign-out and account switch: nothing stays, and nothing waiting is written afterwards. */
    clear() {
      epoch += 1;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      return enqueue(async () => {
        try {
          await store.clear();
        } catch {
          // Nothing to forget in a store that cannot open.
        }
      });
    },
  };
}

const DB_NAME = "corvo-thread-cache";
const META = "meta";
const SNAPSHOTS = "snapshots";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The IndexedDB store: entries in one object store, their sizes and use times in another. */
export function indexedDbThreadCacheStore(factory: IDBFactory = indexedDB): ThreadCacheStore {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META, { keyPath: "key" });
        req.result.createObjectStore(SNAPSHOTS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("thread cache blocked"));
    }).catch((error) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };
  return {
    async get(key) {
      const db = await open();
      return (await request(db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).get(key))) as
        | ThreadSnapshot
        | undefined;
    },
    async put(meta, snapshot, evict) {
      const db = await open();
      const tx = db.transaction([META, SNAPSHOTS], "readwrite");
      tx.objectStore(META).put(meta);
      tx.objectStore(SNAPSHOTS).put(snapshot, meta.key);
      for (const key of evict) {
        tx.objectStore(META).delete(key);
        tx.objectStore(SNAPSHOTS).delete(key);
      }
      await done(tx);
    },
    async touch(key, usedAt) {
      const db = await open();
      const tx = db.transaction(META, "readwrite");
      const meta = (await request(tx.objectStore(META).get(key))) as Meta | undefined;
      if (meta) tx.objectStore(META).put({ ...meta, usedAt });
      await done(tx);
    },
    async metas() {
      const db = await open();
      return (await request(db.transaction(META).objectStore(META).getAll())) as Meta[];
    },
    async clear() {
      const db = await open();
      const tx = db.transaction([META, SNAPSHOTS], "readwrite");
      tx.objectStore(META).clear();
      tx.objectStore(SNAPSHOTS).clear();
      await done(tx);
    },
  };
}

/** The cache the app uses; absent where the browser has no IndexedDB. */
export const threadCache = createThreadCache(
  typeof indexedDB === "undefined"
    ? {
        get: async () => undefined,
        put: async () => undefined,
        touch: async () => undefined,
        metas: async () => [],
        clear: async () => undefined,
      }
    : indexedDbThreadCacheStore(),
);
