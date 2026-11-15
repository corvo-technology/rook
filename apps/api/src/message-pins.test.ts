import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { listPinnedMessages, pinThreadMessage } from "./message-pins.js";
import type { ThreadTarget } from "./thread-target.js";

const actor = { spaceId: "space-1", userId: "user-1" };
const bot = { kind: "bot", botId: "bot-1", threadId: "thread-1" } as ThreadTarget;
const group = {
  kind: "group",
  groupId: "group-1",
  threadId: "thread-2",
  memberBotIds: ["bot-a", "bot-b"],
} as ThreadTarget;

function fixture(message: { id: string; pinnedAt: Date | null } | null) {
  let eventSeq = 0;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    message: {
      findFirst: vi.fn().mockResolvedValue(message),
      update: vi.fn().mockResolvedValue({}),
    },
    thread: { update: vi.fn(async () => ({ nextEventSeq: ++eventSeq })) },
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "event",
        createdAt: new Date(),
        ...data,
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  return { tx, prisma };
}

describe("pinThreadMessage", () => {
  it("pins a message of the thread and announces it", async () => {
    const { tx, prisma } = fixture({ id: "m1", pinnedAt: null });
    const result = await pinThreadMessage(prisma, actor, bot, { messageId: "m1", pinned: true });
    expect(tx.message.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", threadId: "thread-1" },
      select: { id: true, pinnedAt: true },
    });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { pinnedAt: expect.any(Date), pinnedBy: "user-1" },
    });
    expect(result.pinnedAt).toBeInstanceOf(Date);
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "thread.message.pinned",
        botId: "bot-1",
        payload: { messageId: "m1", pinnedAt: result.pinnedAt?.toISOString() },
      }),
    });
  });

  it("unpins, clearing who pinned it", async () => {
    const { tx, prisma } = fixture({ id: "m1", pinnedAt: new Date() });
    const result = await pinThreadMessage(prisma, actor, group, { messageId: "m1", pinned: false });
    expect(result.pinnedAt).toBeNull();
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { pinnedAt: null, pinnedBy: null },
    });
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botId: "bot-a",
        payload: { messageId: "m1", pinnedAt: null },
      }),
    });
  });

  it("changes nothing when the message already has the asked state", async () => {
    const pinnedAt = new Date("2026-11-10T09:00:00Z");
    const { tx, prisma } = fixture({ id: "m1", pinnedAt });
    const result = await pinThreadMessage(prisma, actor, bot, { messageId: "m1", pinned: true });
    expect(result).toEqual({ pinnedAt, eventSeq: null });
    expect(tx.message.update).not.toHaveBeenCalled();
    expect(tx.event.create).not.toHaveBeenCalled();
  });

  it("refuses a message that belongs to another thread", async () => {
    const { tx, prisma } = fixture(null);
    await expect(
      pinThreadMessage(prisma, actor, bot, { messageId: "elsewhere", pinned: true }),
    ).rejects.toThrow();
    expect(tx.message.update).not.toHaveBeenCalled();
  });
});

describe("listPinnedMessages", () => {
  it("reads only the pinned messages of the thread, newest pin first", async () => {
    const pinnedAt = new Date("2026-11-10T09:00:00Z");
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "m1",
        threadId: "thread-1",
        seq: 4,
        role: "bot",
        blocks: [{ kind: "text", text: "Fechamento" }],
        botId: "bot-1",
        replyToMessageId: null,
        replyQuote: null,
        runId: null,
        pinnedAt,
        createdAt: new Date("2026-11-10T08:00:00Z"),
      },
    ]);
    const prisma = { message: { findMany }, run: { findMany: vi.fn() } } as unknown as PrismaClient;
    const messages = await listPinnedMessages(prisma, bot);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId: "thread-1", pinnedAt: { not: null } },
        orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.pinnedAt).toBe(pinnedAt.toISOString());
  });
});
