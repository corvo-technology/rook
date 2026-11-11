import type { PrismaClient } from "@corvo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertIfMonthCrossed } from "./budget-alert.js";
import type { ExecutorDeps } from "./executor-deps.js";

const claim = vi.hoisted(() => vi.fn());
const publishMessage = vi.hoisted(() => vi.fn());
const notifyRun = vi.hoisted(() => vi.fn());

vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  claimBudgetAlert: claim,
}));
vi.mock("./run-messages.js", () => ({ publishMessage }));
vi.mock("./run-notifications.js", () => ({ notifyRun }));

const deps = { prisma: {} as PrismaClient } as unknown as ExecutorDeps;
const run = {
  id: "run-1",
  spaceId: "space-1",
  userId: "user-1",
  threadId: "thread-1",
  botId: "bot-1",
  trigger: "user",
};
const bot = { id: "bot-1", name: "Ana" };
const now = new Date("2026-11-10T12:00:00Z");

beforeEach(() => {
  claim.mockReset().mockResolvedValue(true);
  publishMessage.mockReset().mockResolvedValue(null);
  notifyRun.mockReset().mockResolvedValue(undefined);
});

describe("alertIfMonthCrossed", () => {
  it("posts one line and one push when the month crosses 80%", async () => {
    await alertIfMonthCrossed(
      deps,
      run,
      bot,
      { usedBefore: 790_000, spentThisAttempt: 20_000, limit: 1_000_000 },
      now,
    );
    expect(claim).toHaveBeenCalledWith(deps.prisma, "bot-1", "2026-11");
    expect(publishMessage).toHaveBeenCalledWith(deps, run, "system", [
      { kind: "meta", text: "810,000 of 1,000,000 tokens" },
    ]);
    expect(notifyRun).toHaveBeenCalledWith(
      deps,
      run,
      expect.objectContaining({
        kind: "help",
        title: "Ana used 80% of its monthly token limit",
        body: "810,000 of 1,000,000 tokens",
      }),
    );
  });

  it("stays quiet when another run already claimed the month", async () => {
    claim.mockResolvedValue(false);
    await alertIfMonthCrossed(
      deps,
      run,
      bot,
      { usedBefore: 790_000, spentThisAttempt: 20_000, limit: 1_000_000 },
      now,
    );
    expect(publishMessage).not.toHaveBeenCalled();
    expect(notifyRun).not.toHaveBeenCalled();
  });

  it.each([
    ["without a limit", { usedBefore: 0, spentThisAttempt: 10 ** 9, limit: null }],
    ["below 80%", { usedBefore: 100, spentThisAttempt: 100, limit: 1_000_000 }],
    ["at 100%", { usedBefore: 790_000, spentThisAttempt: 210_000, limit: 1_000_000 }],
    ["already past 80%", { usedBefore: 850_000, spentThisAttempt: 10_000, limit: 1_000_000 }],
  ])("stays quiet %s", async (_name, input) => {
    await alertIfMonthCrossed(deps, run, bot, input, now);
    expect(claim).not.toHaveBeenCalled();
    expect(publishMessage).not.toHaveBeenCalled();
    expect(notifyRun).not.toHaveBeenCalled();
  });

  it("swallows a failing notification", async () => {
    notifyRun.mockRejectedValue(new Error("push down"));
    await expect(
      alertIfMonthCrossed(
        deps,
        run,
        bot,
        { usedBefore: 790_000, spentThisAttempt: 20_000, limit: 1_000_000 },
        now,
      ),
    ).resolves.toBeUndefined();
  });
});
