import type { Prisma } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { resolveThreadRoot, threadConversationBot } from "./thread-root.js";

function client(rows: Record<string, unknown>, latestBotId?: string) {
  return {
    message: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; role?: string } }) =>
        where.role === "bot"
          ? latestBotId
            ? { botId: latestBotId }
            : null
          : (rows[where.id!] ?? null),
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("resolveThreadRoot", () => {
  it("is the message itself when it opens the thread", async () => {
    const root = { id: "m1", botId: null, blocks: [], threadRootId: null };
    await expect(resolveThreadRoot(client({ m1: root }), "t", "m1")).resolves.toMatchObject({
      id: "m1",
    });
  });

  it("is the thread's root when asked about one of its replies, so threads never nest", async () => {
    const rows = {
      reply: { id: "reply", botId: "cora", blocks: [], threadRootId: "root" },
      root: { id: "root", botId: null, blocks: [] },
    };
    await expect(resolveThreadRoot(client(rows), "t", "reply")).resolves.toMatchObject({
      id: "root",
    });
  });

  it("refuses a message that is not in this channel", async () => {
    await expect(resolveThreadRoot(client({}), "t", "elsewhere")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("threadConversationBot", () => {
  const members = ["cora", "bento"];
  const plain = { id: "root", botId: null, blocks: [] };

  it("is whoever answered last in the thread", async () => {
    expect(await threadConversationBot(client({}, "bento"), "t", plain, members)).toBe("bento");
  });

  it("is the agent a hand-off gave the work to, before anyone has answered", async () => {
    const handoff = {
      id: "root",
      botId: "cora",
      blocks: [{ kind: "handoff", fromBotId: "cora", toBotId: "bento", text: "do it" }],
    };
    expect(await threadConversationBot(client({}), "t", handoff, members)).toBe("bento");
  });

  it("is the author of a root an agent wrote", async () => {
    expect(await threadConversationBot(client({}), "t", { ...plain, botId: "cora" }, members)).toBe(
      "cora",
    );
  });

  it("leaves the choice to the channel when nobody in the thread is a member any more", async () => {
    expect(
      await threadConversationBot(client({}), "t", { ...plain, botId: "gone" }, members),
    ).toBeUndefined();
    expect(await threadConversationBot(client({}), "t", plain, members)).toBeUndefined();
  });
});
