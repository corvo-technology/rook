import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { ThreadTarget } from "./thread-target.js";
import { sendThreadMessage } from "./thread-target.js";

// These tests are about the model of a send; who may talk to an agent has its own tests.
vi.mock("./agent-audience.js", () => ({
  requireInAudience: async () => undefined,
  requireCanTalkTo: async () => undefined,
  talkableBotIds: async (_prisma: unknown, _actor: unknown, ids: string[]) => new Set(ids),
}));

const chosen = { provider: "anthropic", modelId: "claude-sonnet-4-5" };

function fixture(options: { activeRuns?: object[] } = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "thread-1" }]),
    thread: {
      update: vi.fn(async ({ data }: { data: { nextMessageSeq?: unknown } }) =>
        data.nextMessageSeq ? { nextMessageSeq: 1 } : { nextEventSeq: 1 },
      ),
    },
    message: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "message-1", seq: 1 }),
      update: vi.fn(),
    },
    run: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue(options.activeRuns ?? []),
      findUnique: vi.fn().mockResolvedValue({ status: "queued", startedAt: null }),
      create: vi.fn().mockResolvedValue({ id: "run-1", taskId: "task-1", status: "queued" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    task: { create: vi.fn().mockResolvedValue({ id: "task-1" }) },
    steeringMessage: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    event: {
      create: vi.fn().mockResolvedValue({ seq: 1 }),
      findFirst: vi.fn().mockResolvedValue({ seq: 1, payload: {} }),
    },
    bot: { update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  };
  const prisma = {
    ...tx,
    usageRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  } as unknown as PrismaClient;
  const send = (input: { model?: typeof chosen }, kind: "bot" | "group" = "bot") =>
    sendThreadMessage(
      {
        prisma,
        events: { notify: vi.fn().mockResolvedValue(undefined) } as never,
        jobs: { enqueue: vi.fn().mockResolvedValue(undefined) } as never,
      },
      { userId: "user-1", spaceId: "space-1" } as Actor,
      (kind === "bot"
        ? {
            kind: "bot",
            botId: "bot-1",
            threadId: "thread-1",
            bot: { id: "bot-1", modelProvider: "openai", modelId: "gpt-5", computer: null },
          }
        : {
            kind: "group",
            groupId: "group-1",
            threadId: "thread-1",
            members: [],
            memberBotIds: [],
          }) as ThreadTarget,
      { text: "Hello", clientNonce: "n-1", ...input },
    );
  return { tx, send };
}

describe("a message sent on a chosen model", () => {
  it("starts a run pinned to that model and leaves the agent's own model alone", async () => {
    const { tx, send } = fixture();
    await send({ model: chosen });
    expect(tx.run.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-5",
        modelPinned: true,
        thinkingLevel: null,
      }),
    });
    expect(tx.bot.update).not.toHaveBeenCalled();
    expect(tx.bot.updateMany).not.toHaveBeenCalled();
  });

  it("starts an unpinned run when no model is chosen, so the agent's own model applies", async () => {
    const { tx, send } = fixture();
    await send({});
    const data = (tx.run.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(data).not.toHaveProperty("modelPinned");
    expect(data).not.toHaveProperty("modelId");
  });

  it("holds the choice with a message that waits for the next run", async () => {
    const { tx, send } = fixture({
      activeRuns: [{ id: "run-0", status: "running", trigger: "user", taskId: "task-0" }],
    });
    await send({ model: chosen });
    const rows = tx.steeringMessage.create.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    for (const [{ data }] of rows) {
      if (data.runId === null) expect(data).toMatchObject({ modelId: "claude-sonnet-4-5" });
      else expect(data).not.toHaveProperty("modelId");
    }
  });

  it("is refused in a channel, where several agents answer", async () => {
    const { send } = fixture();
    await expect(send({ model: chosen }, "group")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
