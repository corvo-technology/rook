import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "./client.js";
import { notifyForMessage, raiseNotification } from "./notifications.js";

function fakeTx(options: { replyAuthors?: string[]; rootAuthor?: string | null } = {}) {
  const raised: Array<{ userId: string; kind: string; dedupeKey: string }> = [];
  const tx = {
    notification: {
      upsert: vi.fn(
        async ({ create }: { create: { userId: string; kind: string; dedupeKey: string } }) => {
          raised.push(create);
          return { id: `n-${raised.length}` };
        },
      ),
    },
    chatGroup: {
      findUnique: vi.fn(async () => ({ userId: "olivia", accessRoleIds: [], people: [] })),
    },
    spaceMember: {
      findMany: vi.fn(async () => ["olivia", "beatrice", "cyrus"].map((userId) => ({ userId }))),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [
          { id: "olivia", name: "Olivia", email: "o@example.test" },
          { id: "beatrice", name: "Beatrice Gold", email: "b@example.test" },
          { id: "cyrus", name: "Cyrus", email: "c@example.test" },
        ].filter((user) => where.id.in.includes(user.id)),
      ),
    },
    message: {
      findUnique: vi.fn(async () => ({ authorUserId: options.rootAuthor ?? null })),
      findMany: vi.fn(async () =>
        (options.replyAuthors ?? []).map((authorUserId) => ({ authorUserId })),
      ),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, raised, spies: tx };
}

const base = { spaceId: "s", thread: { id: "t", groupId: "g", direct: null } };
const text = (value: string) => [{ kind: "text", text: value }];

describe("notifyForMessage", () => {
  it("raises a DM for the other person of a direct conversation", async () => {
    const { tx, raised } = fakeTx();
    await notifyForMessage(tx, {
      spaceId: "s",
      thread: { id: "d", groupId: null, direct: { userAId: "a", userBId: "b" } },
      message: { id: "m", role: "user", authorUserId: "b", threadRootId: null, blocks: text("hi") },
    });
    expect(raised).toEqual([
      expect.objectContaining({ userId: "a", kind: "dm", dedupeKey: "dm:d" }),
    ]);
  });

  it("raises a mention for each person named by full name or unique first name, never the author", async () => {
    const { tx, raised } = fakeTx();
    await notifyForMessage(tx, {
      ...base,
      message: {
        id: "m",
        role: "user",
        authorUserId: "olivia",
        threadRootId: null,
        blocks: text("ping @Beatrice and @Cyrus, and @Olivia"),
      },
    });
    expect(raised.map((row) => [row.userId, row.kind]).sort()).toEqual([
      ["beatrice", "mention"],
      ["cyrus", "mention"],
    ]);
  });

  it("raises nothing for a message that names nobody and replies to nothing", async () => {
    const { tx, raised, spies } = fakeTx();
    await notifyForMessage(tx, {
      ...base,
      message: {
        id: "m",
        role: "user",
        authorUserId: "olivia",
        threadRootId: null,
        blocks: text("hello"),
      },
    });
    expect(raised).toEqual([]);
    expect(spies.chatGroup.findUnique).not.toHaveBeenCalled();
  });

  it("raises a reply for the root's author and earlier repliers, once, and a mention wins over a reply", async () => {
    const { tx, raised } = fakeTx({ rootAuthor: "beatrice", replyAuthors: ["cyrus", "beatrice"] });
    await notifyForMessage(tx, {
      ...base,
      message: {
        id: "m",
        role: "user",
        authorUserId: "olivia",
        threadRootId: "root",
        blocks: text("thanks @Cyrus"),
      },
    });
    expect(raised.map((row) => [row.userId, row.kind]).sort()).toEqual([
      ["beatrice", "reply"],
      ["cyrus", "mention"],
    ]);
  });

  it("ignores system messages and chats with a single agent", async () => {
    const { tx, raised } = fakeTx();
    await notifyForMessage(tx, {
      ...base,
      message: {
        id: "m",
        role: "system",
        authorUserId: null,
        threadRootId: null,
        blocks: text("@Cyrus"),
      },
    });
    await notifyForMessage(tx, {
      spaceId: "s",
      thread: { id: "t", groupId: null, direct: null },
      message: {
        id: "m",
        role: "bot",
        authorUserId: null,
        threadRootId: null,
        blocks: text("@Cyrus"),
      },
    });
    expect(raised).toEqual([]);
  });
});

describe("raiseNotification", () => {
  it("refreshes an entry for the same source and makes it unread again", async () => {
    const upsert = vi.fn(async () => ({ id: "n" }));
    await raiseNotification({ notification: { upsert } } as never, {
      spaceId: "s",
      userId: "u",
      kind: "alert",
      dedupeKey: "alert:budget",
      detail: "80% of the monthly limit",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_dedupeKey: { userId: "u", dedupeKey: "alert:budget" } },
        update: expect.objectContaining({ readAt: null }),
      }),
    );
  });
});
