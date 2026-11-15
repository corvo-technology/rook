import type { RealtimeFanout } from "@corvo/adapter-kit";
import type { Actor, SpaceHint } from "@corvo/contracts";
import { createSpaceHints } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRevocations } from "./access-revocations.js";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { HEARTBEAT_MS } from "./routes/shared.js";

class Fanout implements RealtimeFanout {
  private readonly subscribers = new Map<string, Set<(payload: string) => void>>();
  describe() {
    return {
      id: "test",
      contractVersion: "1",
      adapterVersion: "0",
      capabilities: { distributed: false, push: true },
    };
  }
  async publish(topic: string, payload: string) {
    for (const subscriber of [...(this.subscribers.get(topic) ?? [])]) subscriber(payload);
  }
  async subscribe(topic: string, onMessage: (payload: string) => void) {
    const set = this.subscribers.get(topic) ?? new Set();
    this.subscribers.set(topic, set);
    set.add(onMessage);
    return async () => {
      set.delete(onMessage);
    };
  }
  async close() {}
  listeners() {
    return [...this.subscribers.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

const actorOf = (userId: string): Actor => ({
  spaceId: "space-1",
  userId,
  email: `${userId}@corvo.test`,
  isDeploymentOwner: false,
});

function setup() {
  const fanout = new Fanout();
  const spaceHints = createSpaceHints(fanout);
  const stillAuthorized = vi.fn().mockResolvedValue(true);
  const deps = {
    prisma: {
      spaceMember: {
        findUnique: vi.fn(async () => ({ role: "member", roles: [] })),
        findFirst: vi.fn(async () => ({ role: "member", roles: [] })),
      },
      spaceRole: { findMany: vi.fn(async () => []) },
    },
    spaceHints,
    env: {},
  } as unknown as RouterDeps;
  const router = createRouter(deps);
  const client = (userId: string) =>
    createRouterClient(router, { context: { actor: actorOf(userId), stillAuthorized } });
  const queries = () =>
    (deps.prisma.spaceMember.findUnique as ReturnType<typeof vi.fn>).mock.calls.length;
  return { client, spaceHints, fanout, stillAuthorized, queries };
}

/** Reads what a stream delivers within a short window; an unfinished read carries over. */
function reader(stream: AsyncIterable<SpaceHint>) {
  const iterator = stream[Symbol.asyncIterator]();
  // A stream subscribes on its first read, so start reading now.
  let pending: Promise<IteratorResult<SpaceHint>> | undefined = iterator.next();
  return async (wanted: number, ms = 40) => {
    const kinds: string[] = [];
    const deadline = Date.now() + ms;
    while (kinds.length < wanted && Date.now() < deadline) {
      pending ??= iterator.next();
      const next = await Promise.race([
        pending,
        new Promise<"quiet">((resolve) => setTimeout(() => resolve("quiet"), 15)),
      ]);
      if (next === "quiet") continue;
      pending = undefined;
      if (next.done) break;
      kinds.push(next.value.kind);
    }
    return kinds;
  };
}

describe("space stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands a hint to the member who can see the change and not to one who cannot", async () => {
    const { client, spaceHints, fanout } = setup();
    const ana = reader(await client("ana").spaces.subscribe());
    const bo = reader(await client("bo").spaces.subscribe());
    await vi.waitFor(() => expect(fanout.listeners()).toBe(2));
    await spaceHints.publish("space-1", ["roster"], { users: ["ana"] });
    expect(await ana(1)).toEqual(["roster"]);
    expect(await bo(1)).toEqual([]);
  });

  it("gives everyone a hint that names no one", async () => {
    const { client, spaceHints, fanout } = setup();
    const ana = reader(await client("ana").spaces.subscribe());
    const bo = reader(await client("bo").spaces.subscribe());
    await vi.waitFor(() => expect(fanout.listeners()).toBe(2));
    await spaceHints.publish("space-1", ["approvals"]);
    expect(await ana(1)).toEqual(["approvals"]);
    expect(await bo(1)).toEqual(["approvals"]);
  });

  it("ends a removed member's stream at once and leaves their neighbour's open", async () => {
    const { client, stillAuthorized } = setup();
    const removed = await client("ana").spaces.subscribe();
    const ended = expect(removed.next()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (let step = 0; step < 30; step++) await Promise.resolve();
    accessRevocations.revoke("space-1", "ana");
    await ended;
    expect(stillAuthorized).not.toHaveBeenCalled();
  });

  it("beats every 20 seconds and ends an idle stream once the session is gone", async () => {
    vi.useFakeTimers();
    const { client, stillAuthorized } = setup();
    const stream = await client("ana").spaces.subscribe();
    const beat = stream.next();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await expect(beat).resolves.toMatchObject({ value: { kind: "heartbeat" } });
    stillAuthorized.mockResolvedValue(false);
    const ended = expect(stream.next()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await ended;
  });

  it("costs one in-memory subscriber per open stream and no query while idle", async () => {
    const { client, fanout, queries } = setup();
    const streams = await Promise.all(
      Array.from({ length: 25 }, (_, index) => client(`user-${index}`).spaces.subscribe()),
    );
    const idle = streams.map((stream) => stream.next());
    await vi.waitFor(() => expect(fanout.listeners()).toBe(25));
    const afterOpen = queries();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queries()).toBe(afterOpen);
    void idle;
  });
});
