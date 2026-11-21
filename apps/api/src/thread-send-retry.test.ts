import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { ThreadTarget } from "./thread-target.js";
import { sendThreadMessage } from "./thread-target.js";

// These tests are about the thread mechanics; who may talk to an agent has its own tests.
vi.mock("./agent-audience.js", () => ({
  requireInAudience: async () => undefined,
  requireCanTalkTo: async () => undefined,
  talkableBotIds: async (_prisma: unknown, _actor: unknown, ids: string[]) => new Set(ids),
}));

function setup(options: { stored?: object; threadGone?: boolean } = {}) {
  const tx = {
    runToolResult: { deleteMany: async () => ({ count: 0 }) },
    externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "group-1" }]),
    thread: {
      update: options.threadGone
        ? vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }))
        : vi.fn().mockResolvedValue({ nextMessageSeq: 9, nextEventSeq: 10 }),
    },
    message: {
      create: vi.fn().mockResolvedValue({ id: "msg-new", seq: 8 }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    run: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ status: "queued", userId: "user-1" }),
      create: vi.fn(async () => ({
        id: "run-a",
        taskId: "task-a",
        botId: "bot-a",
        status: "queued",
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    task: { create: vi.fn().mockResolvedValue({ id: "task-a" }) },
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
    message: { findUnique: vi.fn().mockResolvedValue(options.stored ?? null) },
    event: { findFirst: vi.fn().mockResolvedValue(null) },
    run: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
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
  const send = (input: { text: string; clientNonce?: string }) =>
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
  return { tx, prisma, send };
}

describe("a send retried after a dropped connection", () => {
  it("returns the stored result instead of posting twice", async () => {
    const stored = { id: "msg-1", seq: 3, blocks: [], sourceRuns: [], routing: { picked: [] } };
    const { tx, send } = setup({ stored });
    await expect(send({ text: "hi", clientNonce: "n-1" })).resolves.toEqual({
      seq: 3,
      runIds: [],
    });
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it("still sends from an old client that carries no client id", async () => {
    const { tx, prisma, send } = setup();
    await expect(send({ text: "hi" })).resolves.toMatchObject({ seq: 8 });
    expect(tx.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });
});

describe("a send to a conversation that was deleted", () => {
  it("answers not found, not a server error", async () => {
    const { send } = setup({ threadGone: true });
    await expect(send({ text: "hi", clientNonce: "n-2" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "This conversation no longer exists",
    });
  });
});
