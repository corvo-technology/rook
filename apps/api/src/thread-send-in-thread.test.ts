import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { ThreadTarget } from "./thread-target.js";
import { sendThreadMessage } from "./thread-target.js";

function setup(latestThreadBotId?: string) {
  const root = { id: "root-1", botId: null, blocks: [], threadRootId: null };
  const tx = {
    externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "group-1" }]),
    thread: { update: vi.fn().mockResolvedValue({ nextMessageSeq: 9, nextEventSeq: 10 }) },
    message: {
      create: vi.fn().mockResolvedValue({ id: "msg-new", seq: 8 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(async ({ where }: { where: { id?: string; role?: string } }) =>
        where.role === "bot"
          ? latestThreadBotId
            ? { botId: latestThreadBotId }
            : null
          : where.id === root.id
            ? root
            : null,
      ),
      update: vi.fn(),
    },
    run: {
      findFirst: vi.fn().mockResolvedValue({ botId: "bot-a" }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ status: "queued", userId: "user-1" }),
      create: vi.fn(async ({ data }: { data: { botId: string } }) => ({
        id: `run-${data.botId}`,
        taskId: `task-${data.botId}`,
        botId: data.botId,
        status: "queued",
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    task: { create: vi.fn().mockResolvedValue({ id: "task-new" }) },
    steeringMessage: { create: vi.fn() },
    event: { create: vi.fn().mockResolvedValue({ seq: 4 }) },
    chatGroup: {
      findFirst: vi.fn().mockResolvedValue({
        id: "group-1",
        members: [
          { bot: { id: "bot-a", name: "Alpha", color: null } },
          { bot: { id: "bot-b", name: "Beta", color: null } },
        ],
      }),
      update: vi.fn(),
    },
  };
  const prisma = {
    message: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  const target = {
    kind: "group",
    groupId: "group-1",
    groupName: "Group",
    threadId: "thread-1",
    members: [],
    memberBotIds: ["bot-a", "bot-b"],
  } satisfies ThreadTarget;
  const send = (input: { text: string; threadRootId?: string }) =>
    sendThreadMessage(
      {
        prisma,
        events: { notify: vi.fn().mockResolvedValue(undefined) } as never,
        jobs: { enqueue: vi.fn().mockResolvedValue(undefined) } as never,
      },
      { spaceId: "workspace-1", userId: "user-1" } as Actor,
      target,
      input,
    );
  return { tx, send };
}

describe("a message posted in a channel thread", () => {
  it("is stored under its root, tells the channel so, and wakes whoever answered in the thread", async () => {
    const { tx, send } = setup("bot-b");
    await send({ text: "and the second part?", threadRootId: "root-1" });
    expect(tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadRootId: "root-1", role: "user" }),
    });
    expect(tx.run.create).toHaveBeenCalledTimes(1);
    expect(tx.run.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ botId: "bot-b", sourceMessageId: "msg-new" }),
    });
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "thread.message.created",
        payload: expect.objectContaining({ threadRootId: "root-1" }),
      }),
    });
  });

  it("still goes to a member the text names", async () => {
    const { tx, send } = setup("bot-b");
    await send({ text: "@Alpha can you check?", threadRootId: "root-1" });
    expect(tx.run.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ botId: "bot-a" }),
    });
  });

  it("is refused when its root is not in the channel", async () => {
    const { tx, send } = setup();
    await expect(send({ text: "hello", threadRootId: "elsewhere" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it("stays in the main column without a root", async () => {
    const { tx, send } = setup("bot-b");
    await send({ text: "hello" });
    expect(tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadRootId: undefined }),
    });
  });
});
