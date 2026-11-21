import { beforeEach, describe, expect, it, vi } from "vitest";

const createThreadMessageInTransaction = vi.hoisted(() => vi.fn());
const appendEventInTransaction = vi.hoisted(() => vi.fn());
vi.mock("@corvo/db", () => ({
  createThreadMessageInTransaction,
  appendEventInTransaction,
  warmThreadContentKey: async () => undefined,
  withTransactionRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import { noteApprovalInParentChat } from "./run-parent-notice.js";

const tx = {};
const prisma = {
  thread: { findUnique: vi.fn() },
  bot: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
};
const events = { notify: vi.fn() };
const deps = { prisma, events } as never;
const child = {
  id: "child",
  name: "Rookup X Manager",
  spaceId: "space",
  userId: "user",
  parentBotId: "chief",
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.thread.findUnique.mockResolvedValue({ id: "chief-thread" });
  prisma.bot.findFirst.mockResolvedValue({ id: "chief" });
  createThreadMessageInTransaction.mockResolvedValue({ id: "message" });
  appendEventInTransaction.mockResolvedValue({ seq: 7 });
});

describe("noteApprovalInParentChat", () => {
  it("tells the chat of the bot that created this one that it is waiting for an answer", async () => {
    await noteApprovalInParentChat(deps, { bot: child, effectId: "effect-1" });
    expect(createThreadMessageInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        threadId: "chief-thread",
        role: "bot",
        botId: "chief",
        clientNonce: "approval-notice:effect-1",
        blocks: [{ kind: "text", text: "Rookup X Manager is waiting for your approval." }],
      }),
    );
    expect(events.notify).toHaveBeenCalledWith("chief-thread", 7);
  });

  it("says nothing for a bot nobody created", async () => {
    await noteApprovalInParentChat(deps, {
      bot: { ...child, parentBotId: null },
      effectId: "effect-1",
    });
    expect(createThreadMessageInTransaction).not.toHaveBeenCalled();
  });

  it("says nothing when the creator is archived or belongs to someone else", async () => {
    prisma.bot.findFirst.mockResolvedValue(null);
    await noteApprovalInParentChat(deps, { bot: child, effectId: "effect-1" });
    expect(createThreadMessageInTransaction).not.toHaveBeenCalled();
    expect(prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "chief",
          spaceId: "space",
          userId: "user",
          archivedAt: null,
        }),
      }),
    );
  });

  it("does not post twice for the same approval", async () => {
    createThreadMessageInTransaction.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    await expect(
      noteApprovalInParentChat(deps, { bot: child, effectId: "effect-1" }),
    ).resolves.toBeUndefined();
    expect(events.notify).not.toHaveBeenCalled();
  });

  it("never fails the run it is reporting on", async () => {
    prisma.thread.findUnique.mockRejectedValue(new Error("database is down"));
    await expect(
      noteApprovalInParentChat(deps, { bot: child, effectId: "effect-1" }),
    ).resolves.toBeUndefined();
  });
});
