import type { RealtimeFanout } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { HintViewer } from "./space-hints.js";
import {
  botReach,
  createSpaceHints,
  hintReaches,
  hintThreadChange,
  threadHintTarget,
} from "./space-hints.js";

class Fanout implements RealtimeFanout {
  private readonly subscribers = new Map<string, Set<(payload: string) => void>>();
  published: Array<{ topic: string; payload: string }> = [];
  describe() {
    return {
      id: "test",
      contractVersion: "1",
      adapterVersion: "0",
      capabilities: { distributed: false, push: true },
    };
  }
  async publish(topic: string, payload: string) {
    this.published.push({ topic, payload });
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
  count(topic: string) {
    return this.subscribers.get(topic)?.size ?? 0;
  }
}

const member = (userId: string, roleIds: string[] = [], manageChannels = false): HintViewer => ({
  userId,
  roleIds,
  manageChannels,
});

async function nextKind(stream: AsyncGenerator<{ kind: string }>) {
  const result = await Promise.race([
    stream.next(),
    new Promise<"quiet">((resolve) => setTimeout(() => resolve("quiet"), 20)),
  ]);
  return result === "quiet" ? "quiet" : result.done ? "done" : result.value.kind;
}

describe("hint reach", () => {
  it("reaches everyone when it names no one, and only the named people, roles and managers otherwise", () => {
    expect(hintReaches(undefined, member("anyone"))).toBe(true);
    const reach = { users: ["ana"], roles: ["finance"], managers: true };
    expect(hintReaches(reach, member("ana"))).toBe(true);
    expect(hintReaches(reach, member("bo", ["finance"]))).toBe(true);
    expect(hintReaches(reach, member("cy", [], true))).toBe(true);
    expect(hintReaches(reach, member("dee", ["other"]))).toBe(false);
    expect(hintReaches({ users: ["ana"] }, member("cy", [], true))).toBe(false);
    expect(hintReaches({ users: [] }, member("ana"))).toBe(false);
  });

  it("reads an agent's audience like the rule that lets people talk to it", () => {
    const base = { userId: "owner", audienceRoleIds: ["r1"], audienceUserIds: ["u1"] };
    expect(botReach({ ...base, audienceRestricted: false })).toBeUndefined();
    expect(botReach({ ...base, audienceRestricted: true })).toEqual({
      users: ["owner", "u1"],
      roles: ["r1"],
    });
  });
});

describe("space hint stream", () => {
  it("delivers a hint to a member it reaches and not to one it does not", async () => {
    const fanout = new Fanout();
    const hints = createSpaceHints(fanout);
    const abort = new AbortController();
    const ana = hints.follow("s1", member("ana"), abort.signal);
    const bo = hints.follow("s1", member("bo"), abort.signal);
    const reached = ana.next();
    const missed = nextKind(bo);
    await vi.waitFor(() => expect(fanout.count("space-hints:s1")).toBe(2));
    await hints.publish("s1", ["roster"], { users: ["ana"] });
    await expect(reached).resolves.toMatchObject({ value: { kind: "roster" } });
    expect(await missed).toBe("quiet");
    abort.abort();
  });

  it("keeps one space's hints out of another space's stream", async () => {
    const fanout = new Fanout();
    const hints = createSpaceHints(fanout);
    const abort = new AbortController();
    const other = hints.follow("s2", member("ana"), abort.signal);
    const quiet = nextKind(other);
    await vi.waitFor(() => expect(fanout.count("space-hints:s2")).toBe(1));
    await hints.publish("s1", ["roster"]);
    expect(await quiet).toBe("quiet");
    abort.abort();
  });

  it("coalesces repeated kinds; a stream is one fan-out subscription and no database", async () => {
    const fanout = new Fanout();
    const hints = createSpaceHints(fanout);
    const abort = new AbortController();
    const stream = hints.follow("s1", member("ana"), abort.signal);
    const first = stream.next();
    await vi.waitFor(() => expect(fanout.count("space-hints:s1")).toBe(1));
    await Promise.all([
      hints.publish("s1", ["roster", "roster", "dm"]),
      hints.publish("s1", ["roster"]),
    ]);
    const kinds = [(await first).value?.kind];
    kinds.push((await stream.next()).value?.kind);
    expect(kinds).toEqual(["roster", "dm"]);
    expect(await nextKind(stream)).toBe("quiet");
    abort.abort();
    await vi.waitFor(() => expect(fanout.count("space-hints:s1")).toBe(0));
  });

  it("splits a large audience across notifications under the size limit", async () => {
    const fanout = new Fanout();
    const hints = createSpaceHints(fanout);
    const users = Array.from({ length: 150 }, (_, index) => `user-${index}`);
    await hints.publish("s1", ["roster"], { users, roles: ["r"] });
    expect(fanout.published.length).toBe(3);
    for (const { payload } of fanout.published) {
      expect(Buffer.byteLength(payload)).toBeLessThan(2_000);
    }
  });

  it("ends when its signal aborts", async () => {
    const hints = createSpaceHints(new Fanout());
    const abort = new AbortController();
    const stream = hints.follow("s1", member("ana"), abort.signal);
    const done = stream.next();
    await Promise.resolve();
    abort.abort();
    await expect(done).resolves.toMatchObject({ done: true });
  });
});

describe("who a conversation's change reaches", () => {
  const find = (row: unknown) => ({ thread: { findUnique: vi.fn(async () => row) } });

  it("limits a direct conversation to its two people", async () => {
    const target = await threadHintTarget(
      find({ spaceId: "s1", direct: { userAId: "a", userBId: "b" } }) as never,
      "t1",
    );
    expect(target).toEqual({
      spaceId: "s1",
      kinds: ["dm", "notifications"],
      reach: { users: ["a", "b"] },
    });
  });

  it("leaves an open channel to the whole space and limits a private one", async () => {
    const open = await threadHintTarget(
      find({
        spaceId: "s1",
        direct: null,
        group: { userId: "u", accessRoleIds: [], people: [] },
      }) as never,
      "t1",
    );
    expect(open?.reach).toBeUndefined();
    const closed = await threadHintTarget(
      find({
        spaceId: "s1",
        direct: null,
        group: { userId: "u", accessRoleIds: ["r"], people: [{ userId: "p" }] },
      }) as never,
      "t1",
    );
    expect(closed?.reach).toEqual({ users: ["u", "p"], roles: ["r"], managers: true });
  });

  it("limits a restricted agent's chat to its audience", async () => {
    const target = await threadHintTarget(
      find({
        spaceId: "s1",
        direct: null,
        group: null,
        bot: {
          userId: "owner",
          audienceRestricted: true,
          audienceRoleIds: [],
          audienceUserIds: ["x"],
        },
      }) as never,
      "t1",
    );
    expect(target?.reach).toEqual({ users: ["owner", "x"], roles: [] });
  });

  it("says nothing for a conversation that is gone", async () => {
    expect(await threadHintTarget(find(null) as never, "gone")).toBeNull();
  });
});

describe("thread change hints", () => {
  it("sends one hint now and one when a burst settles", async () => {
    vi.useFakeTimers();
    try {
      const fanout = new Fanout();
      const prisma = {
        thread: {
          findUnique: vi.fn(async () => ({ spaceId: "s1", direct: null, group: null, bot: null })),
        },
      };
      const hints = createSpaceHints(fanout);
      for (let step = 0; step < 20; step++)
        hintThreadChange(prisma as never, hints, "burst-thread");
      await vi.advanceTimersByTimeAsync(0);
      expect(fanout.published).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fanout.published).toHaveLength(2);
      expect(prisma.thread.findUnique).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
