import type { Actor, ProductEvent } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { IsolationError } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { listPendingApprovals } from "./team-chat.js";

const written = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  unread: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  createThreadMessageInTransaction: async (_tx: unknown, input: Record<string, unknown>) => {
    written.messages.push(input);
    return { id: "m-1", seq: 4 };
  },
  markDirectUnreadFor: async (_tx: unknown, input: Record<string, unknown>) => {
    written.unread.push(input);
  },
  appendEventInTransaction: async (_tx: unknown, input: Record<string, unknown>) => {
    written.events.push(input);
    return { seq: 9 };
  },
}));

const actorOf = (userId: string) =>
  ({
    userId,
    spaceId: "space-1",
    email: `${userId}@example.test`,
    isDeploymentOwner: false,
  }) satisfies Actor;

/** A space whose members hold the given base roles ("owner", "admin" or "member"). */
function membership(roles: Record<string, string>) {
  return {
    spaceMember: {
      findUnique: async ({ where }: { where: { spaceId_userId: { userId: string } } }) => {
        const role = roles[where.spaceId_userId.userId];
        return role ? { role, roles: [] } : null;
      },
    },
    spaceRole: { findMany: async () => [] },
  };
}

const askBlock = (effect: string, status?: "answered") => ({
  kind: "ask" as const,
  text: "Send the report",
  approvalEffectId: effect,
  actions: [
    { id: "allow", label: "Allow once" },
    { id: "deny", label: "Not now" },
  ],
  ...(status ? { status } : {}),
});

describe("the approvals inbox", () => {
  const runs = [
    {
      id: "run-own",
      bot: { id: "bot-mine", name: "Cora", color: "#111", userId: "u-member" },
      thread: { group: null },
    },
    {
      id: "run-other",
      bot: { id: "bot-theirs", name: "Bento", color: "#222", userId: "u-owner" },
      thread: {
        group: { id: "g-open", name: "finance", userId: "u-owner", archivedAt: null, people: [] },
      },
    },
    {
      id: "run-private",
      bot: { id: "bot-theirs", name: "Bento", color: "#222", userId: "u-owner" },
      thread: {
        group: {
          id: "g-private",
          name: "board",
          userId: "u-owner",
          archivedAt: null,
          people: [{ userId: "u-owner" }],
        },
      },
    },
  ];
  const messages = [
    { id: "m-own", runId: "run-own", blocks: [askBlock("e1")], createdAt: new Date(1) },
    { id: "m-other", runId: "run-other", blocks: [askBlock("e2")], createdAt: new Date(2) },
    { id: "m-private", runId: "run-private", blocks: [askBlock("e3")], createdAt: new Date(3) },
    {
      id: "m-done",
      runId: "run-other",
      blocks: [askBlock("e4", "answered")],
      createdAt: new Date(4),
    },
  ];

  function db(roles: Record<string, string>) {
    const findRuns = vi.fn(async ({ where }: { where: { bot: { userId?: string } } }) =>
      runs.filter((run) => !where.bot.userId || run.bot.userId === where.bot.userId),
    );
    return {
      findRuns,
      prisma: {
        ...membership(roles),
        run: { findMany: findRuns },
        message: {
          findMany: async ({ where }: { where: { runId: { in: string[] } } }) =>
            messages.filter((message) => where.runId.in.includes(message.runId)),
        },
      } as unknown as PrismaClient,
    };
  }

  it("lists a member only the approvals of agents they own", async () => {
    const { prisma, findRuns } = db({ "u-member": "member", "u-owner": "owner" });
    const items = await listPendingApprovals(prisma, actorOf("u-member"));
    expect(items.map((item) => item.messageId)).toEqual(["m-own"]);
    expect(findRuns.mock.calls[0]?.[0].where.bot.userId).toBe("u-member");
  });

  it("lists everyone's to someone who may approve actions, but not a private channel they are not in", async () => {
    const { prisma } = db({ "u-member": "member", "u-admin": "admin", "u-owner": "owner" });
    const items = await listPendingApprovals(prisma, actorOf("u-admin"));
    expect(items.map((item) => item.messageId)).toEqual(["m-own", "m-other"]);
    expect(items[1]).toMatchObject({ botName: "Bento", groupName: "finance", groupId: "g-open" });
  });

  it("shows the owner every approval, private channels included", async () => {
    const { prisma } = db({ "u-owner": "owner" });
    const items = await listPendingApprovals(prisma, actorOf("u-owner"));
    expect(items.map((item) => item.messageId)).toEqual(["m-own", "m-other", "m-private"]);
  });

  it("drops an approval once it is answered, so the count falls", async () => {
    const { prisma } = db({ "u-owner": "owner" });
    const before = await listPendingApprovals(prisma, actorOf("u-owner"));
    messages[0] = { ...messages[0]!, blocks: [askBlock("e1", "answered")] };
    const after = await listPendingApprovals(prisma, actorOf("u-owner"));
    expect(after).toHaveLength(before.length - 1);
    messages[0] = { ...messages[0]!, blocks: [askBlock("e1")] };
  });

  it("lists nothing for someone who left the space", async () => {
    const { prisma } = db({});
    await expect(listPendingApprovals(prisma, actorOf("u-gone"))).resolves.toEqual([]);
  });
});

describe("direct messages between two people", () => {
  const pair = { threadId: "dm-1", spaceId: "space-1", userAId: "u-a", userBId: "u-b" };

  function harness() {
    written.messages.length = 0;
    written.unread.length = 0;
    written.events.length = 0;
    const followed: string[] = [];
    const notify = vi.fn(async () => undefined);
    const tx = {
      $queryRaw: vi.fn(async () => []),
      message: { findUnique: vi.fn(async () => null) },
    };
    const prisma = {
      ...membership({ "u-a": "member", "u-b": "member", "u-c": "member", "u-out": "" }),
      directThread: {
        findFirst: vi.fn(async ({ where }: { where: { threadId: string; spaceId: string } }) =>
          where.threadId === pair.threadId && where.spaceId === pair.spaceId ? pair : null,
        ),
      },
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      events: {
        notify,
        follow: (threadId: string) => {
          followed.push(threadId);
          return (async function* (): AsyncGenerator<ProductEvent> {
            yield {
              id: "e-1",
              spaceId: "space-1",
              threadId,
              botId: threadId,
              seq: 1,
              type: "thread.message.created",
              createdAt: "2026-11-10T09:00:00.000Z",
              payload: { messageId: "m-1" },
            } as ProductEvent;
          })();
        },
      },
      env: { defaultProvider: "x", defaultModel: "y", webOrigin: "http://localhost" },
    } as unknown as RouterDeps;
    const as = (userId: string) =>
      createRouterClient(createRouter(deps), { context: { actor: actorOf(userId) } as never });
    return { as, notify, followed };
  }

  it("lets either person write, marking only the other person unread", async () => {
    const { as, notify } = harness();
    await expect(as("u-a").directMessages.send({ threadId: "dm-1", text: "oi" })).resolves.toEqual({
      seq: 4,
    });
    expect(written.messages[0]).toMatchObject({
      threadId: "dm-1",
      role: "user",
      authorUserId: "u-a",
      markUnread: false,
    });
    // The shared rule would mark every member of the space; only the partner is marked.
    expect(written.unread).toEqual([
      { threadId: "dm-1", spaceId: "space-1", userId: "u-b", seq: 4 },
    ]);
    expect(notify).toHaveBeenCalledWith("dm-1", 9);
    await as("u-b").directMessages.send({ threadId: "dm-1", text: "oi!" });
    expect(written.unread.at(-1)).toMatchObject({ userId: "u-a" });
  });

  it("refuses a third member everything about the conversation", async () => {
    const { as, notify, followed } = harness();
    const stranger = as("u-c");
    await expect(stranger.directMessages.get({ threadId: "dm-1" })).rejects.toBeInstanceOf(
      IsolationError,
    );
    await expect(
      stranger.directMessages.send({ threadId: "dm-1", text: "hi" }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(stranger.directMessages.markRead({ threadId: "dm-1" })).rejects.toBeInstanceOf(
      IsolationError,
    );
    const stream = await stranger.directMessages.subscribe({ threadId: "dm-1", cursor: -1 });
    await expect(stream.next()).rejects.toBeInstanceOf(IsolationError);
    expect(written.messages).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    // The realtime source is never opened for someone who may not read it.
    expect(followed).toEqual([]);
  });

  it("gives a stranger the same answer for a conversation that does not exist", async () => {
    const { as } = harness();
    const real = as("u-c").directMessages.get({ threadId: "dm-1" });
    const missing = as("u-c").directMessages.get({ threadId: "dm-nope" });
    await expect(real).rejects.toBeInstanceOf(IsolationError);
    await expect(missing).rejects.toBeInstanceOf(IsolationError);
  });

  it("refuses someone who left the space even if they were one of the two", async () => {
    const { as } = harness();
    await expect(as("u-out").directMessages.get({ threadId: "dm-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("streams a participant's events, and only theirs", async () => {
    const { as, followed } = harness();
    const stream = await as("u-b").directMessages.subscribe({ threadId: "dm-1", cursor: -1 });
    const first = await stream.next();
    expect(first.value).toMatchObject({ threadId: "dm-1", type: "thread.message.created" });
    expect(followed).toEqual(["dm-1"]);
    await stream.return?.(undefined);
  });
});

describe("who changes a private channel", () => {
  function channels(roles: Record<string, string>, creator = "u-a") {
    const prisma = {
      ...membership(roles),
      chatGroup: {
        findFirst: vi.fn(async () => ({ userId: creator })),
      },
      chatGroupPerson: { createMany: vi.fn(), deleteMany: vi.fn() },
      $transaction: vi.fn(async (run: (client: unknown) => unknown) =>
        run({
          chatGroup: { findFirst: async () => ({ userId: creator }) },
          spaceMember: { findMany: async () => [{ userId: "u-b" }, { userId: creator }] },
          chatGroupPerson: { createMany: prismaCreate, deleteMany: prismaDelete },
        }),
      ),
    } as unknown as PrismaClient;
    return prisma;
  }
  const prismaCreate = vi.fn();
  const prismaDelete = vi.fn();
  const client = (prisma: PrismaClient, userId: string) =>
    createRouterClient(
      createRouter({
        prisma,
        events: {},
        env: { defaultProvider: "x", defaultModel: "y", webOrigin: "http://localhost" },
      } as unknown as RouterDeps),
      { context: { actor: actorOf(userId) } as never },
    );

  it("lets its creator add a person, who joins the creator on the list", async () => {
    prismaCreate.mockClear();
    await client(channels({ "u-a": "member", "u-b": "member" }), "u-a").groups.people.add({
      groupId: "g-1",
      userIds: ["u-b"],
    });
    expect(
      prismaCreate.mock.calls[0]?.[0].data.map((row: { userId: string }) => row.userId),
    ).toEqual(["u-a", "u-b"]);
  });

  it("lets someone who manages channels add and remove, and no one else", async () => {
    prismaCreate.mockClear();
    prismaDelete.mockClear();
    const prisma = channels({ "u-a": "member", "u-b": "member", "u-admin": "admin" });
    await client(prisma, "u-admin").groups.people.add({ groupId: "g-1", userIds: ["u-b"] });
    await client(prisma, "u-admin").groups.people.remove({ groupId: "g-1", userId: "u-b" });
    expect(prismaCreate).toHaveBeenCalledTimes(1);
    expect(prismaDelete).toHaveBeenCalledTimes(1);
    await expect(
      client(prisma, "u-b").groups.people.add({ groupId: "g-1", userIds: ["u-b"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      client(prisma, "u-b").groups.people.remove({ groupId: "g-1", userId: "u-a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      client(prisma, "u-b").groups.people.open({ groupId: "g-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never takes the creator off their own channel", async () => {
    const prisma = channels({ "u-a": "member", "u-admin": "admin" });
    await expect(
      client(prisma, "u-admin").groups.people.remove({ groupId: "g-1", userId: "u-a" }),
    ).rejects.toBeInstanceOf(IsolationError);
  });
});
