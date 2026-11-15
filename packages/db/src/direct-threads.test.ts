import { describe, expect, it, vi } from "vitest";
import { channelVisibleTo } from "./channel-people.js";
import type { PrismaClient } from "./client.js";
import {
  directPair,
  directPartner,
  listDirectPeople,
  openDirectThread,
  requireDirectThread,
} from "./direct-threads.js";
import { IsolationError } from "./scope.js";

describe("direct pairs", () => {
  it("orders a pair the same way from either side", () => {
    expect(directPair("u-b", "u-a")).toEqual({ userAId: "u-a", userBId: "u-b" });
    expect(directPair("u-a", "u-b")).toEqual({ userAId: "u-a", userBId: "u-b" });
  });

  it("names the other person, and no one for a third", () => {
    const row = { userAId: "u-a", userBId: "u-b" };
    expect(directPartner(row, "u-a")).toBe("u-b");
    expect(directPartner(row, "u-b")).toBe("u-a");
    expect(directPartner(row, "u-c")).toBeNull();
  });

  it("refuses a third person as it refuses a missing conversation", async () => {
    const row = { threadId: "t", spaceId: "s", userAId: "u-a", userBId: "u-b" };
    const db = {
      directThread: {
        findFirst: vi.fn(async ({ where }: { where: { threadId: string } }) =>
          where.threadId === "t" ? row : null,
        ),
      },
    } as unknown as PrismaClient;
    await expect(
      requireDirectThread(db, { spaceId: "s", userId: "u-b", threadId: "t" }),
    ).resolves.toMatchObject({ partnerId: "u-a" });
    await expect(
      requireDirectThread(db, { spaceId: "s", userId: "u-c", threadId: "t" }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(
      requireDirectThread(db, { spaceId: "s", userId: "u-a", threadId: "other" }),
    ).rejects.toBeInstanceOf(IsolationError);
  });
});

describe("opening a conversation", () => {
  it("never opens one with yourself or with someone outside the space", async () => {
    const tx = { spaceMember: { count: vi.fn(async () => 1) }, thread: { create: vi.fn() } };
    const db = {
      directThread: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaClient;
    await expect(
      openDirectThread(db, { spaceId: "s", userId: "u-a", withUserId: "u-a" }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(
      openDirectThread(db, { spaceId: "s", userId: "u-a", withUserId: "u-out" }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(tx.thread.create).not.toHaveBeenCalled();
  });

  it("opens the conversation that is already there", async () => {
    const db = {
      directThread: { findUnique: vi.fn(async () => ({ threadId: "t-1" })) },
    } as unknown as PrismaClient;
    await expect(
      openDirectThread(db, { spaceId: "s", userId: "u-b", withUserId: "u-a" }),
    ).resolves.toBe("t-1");
  });

  it("makes a thread no wiki reads, for the sorted pair", async () => {
    const create = vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: "t-new" }));
    const createDirect = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
    const tx = {
      spaceMember: { count: vi.fn(async () => 2) },
      thread: { create },
      directThread: { create: createDirect },
    };
    const db = {
      directThread: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    } as unknown as PrismaClient;
    await expect(
      openDirectThread(db, { spaceId: "s", userId: "u-b", withUserId: "u-a" }),
    ).resolves.toBe("t-new");
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ wikiCapture: false });
    expect(createDirect.mock.calls[0]?.[0].data).toMatchObject({
      threadId: "t-new",
      userAId: "u-a",
      userBId: "u-b",
    });
  });
});

describe("the people list", () => {
  it("lists the other members with their own conversation and unread", async () => {
    const member = (userId: string, name: string) => ({
      userId,
      member: { user: { name, email: `${userId}@example.test`, image: null } },
    });
    const readRows = vi.fn(async () => [{ threadId: "t-ab", unread: true }]);
    const db = {
      spaceMember: {
        findMany: vi.fn(async () => [member("u-b", "Joao"), member("u-c", "Marta")]),
      },
      directThread: {
        findMany: vi.fn(async () => [{ threadId: "t-ab", userAId: "u-a", userBId: "u-b" }]),
      },
      threadMemberRead: { findMany: readRows },
    } as unknown as PrismaClient;
    const people = await listDirectPeople(db, { spaceId: "s", userId: "u-a" });
    expect(people).toEqual([
      { userId: "u-b", name: "Joao", image: null, threadId: "t-ab", unread: true },
      { userId: "u-c", name: "Marta", image: null, threadId: null, unread: false },
    ]);
    // Only this person's own read state is read.
    expect((readRows.mock.calls[0] as unknown as [{ where: object }])[0].where).toMatchObject({
      userId: "u-a",
    });
  });
});

describe("who sees a channel", () => {
  it("is open to all unless people were added, and always to its creator and those people", () => {
    expect(channelVisibleTo({ userId: "u-a", roleIds: [], seesAll: false })).toEqual({
      OR: [
        { userId: "u-a" },
        { people: { none: {} }, accessRoleIds: { isEmpty: true } },
        { people: { some: { userId: "u-a" } } },
      ],
    });
  });
});
