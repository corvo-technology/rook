import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { ROUTER_PASS_INSTRUCTION, routerAnsweredNote } from "./router-pass.js";
import { taskTools } from "./run-tools-tasks.js";

function prismaWith(replies: Array<{ botId: string; text: string }>) {
  return {
    message: {
      findMany: vi.fn().mockResolvedValue(
        replies.map((reply) => ({
          botId: reply.botId,
          blocks: [{ kind: "text", text: reply.text }],
        })),
      ),
    },
    bot: {
      findMany: vi.fn().mockResolvedValue([{ id: "bot-b", name: "Beto" }]),
    },
  } as unknown as PrismaClient;
}

describe("the router pass text", () => {
  it("tells the agent it may pass, in fixed text", () => {
    expect(ROUTER_PASS_INSTRUCTION).toContain("call pass");
  });

  it("has no note when nobody answered", async () => {
    const note = await routerAnsweredNote(prismaWith([]), {
      threadId: "thread-1",
      sourceMessageSeq: 3,
      botId: "bot-a",
    });
    expect(note).toBeUndefined();
  });

  it("shows what another agent already answered, as data", async () => {
    const prisma = prismaWith([{ botId: "bot-b", text: "Refunds take 5 days." }]);
    const text = await routerAnsweredNote(prisma, {
      threadId: "thread-1",
      sourceMessageSeq: 3,
      botId: "bot-a",
    });
    expect(text).toContain('- "Beto: Refunds take 5 days."');
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ seq: { gt: 3 }, botId: { not: "bot-a" } }),
      }),
    );
  });
});

describe("the pass tool", () => {
  it("ends the turn quietly", async () => {
    const state = { passed: false };
    const finish = vi.fn((result: unknown) => result);
    await taskTools.pass?.({ state } as never, { finish } as never);
    expect(state.passed).toBe(true);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
