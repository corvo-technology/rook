import { COMPRESS_KEEP_RECENT } from "@corvo/adapters";
import { describe, expect, it, vi } from "vitest";
import { compressForChosenModel, compressThread } from "./thread-context.js";

vi.mock("@corvo/adapters", async (original) => ({
  ...(await original<typeof import("@corvo/adapters")>()),
  modelContextWindow: (_provider: string, modelId: string) =>
    modelId === "small" ? 32_000 : modelId === "large" ? 1_000_000 : null,
}));

describe("compressThread", () => {
  it("queues one compaction that keeps the newest messages", async () => {
    const enqueue = vi.fn(async () => undefined);
    await compressThread({ jobs: { enqueue } } as never, "thread-1");
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "history.compact",
        payload: { threadId: "thread-1", keepRecent: COMPRESS_KEEP_RECENT },
      }),
    );
  });
});

describe("compressForChosenModel", () => {
  const chat = { botId: "bot-1", threadId: "thread-1" };
  const scope = { spaceId: "space-1", userId: "user-1" };
  const run = async (modelId: string, inputTokens: number | null) => {
    const enqueue = vi.fn(async () => undefined);
    const prisma = {
      usageRecord: {
        findFirst: vi.fn(async () =>
          inputTokens === null
            ? null
            : {
                provider: "p",
                model: "m",
                inputTokens,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
        ),
      },
    };
    await compressForChosenModel({ prisma, jobs: { enqueue } } as never, scope, chat, {
      provider: "p",
      modelId,
    });
    return enqueue;
  };

  it("summarizes first when the chat no longer fits the chosen model's window", async () => {
    expect(await run("small", 60_000)).toHaveBeenCalledTimes(1);
  });

  it("leaves a chat that fits alone", async () => {
    expect(await run("large", 60_000)).not.toHaveBeenCalled();
  });

  it("does nothing when the window or the usage is unknown", async () => {
    expect(await run("unlisted", 60_000)).not.toHaveBeenCalled();
    expect(await run("small", null)).not.toHaveBeenCalled();
  });
});
