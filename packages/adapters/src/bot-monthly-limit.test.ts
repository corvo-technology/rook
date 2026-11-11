import { utcMonthStart } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { botMonthUsage } from "./bot-monthly-limit.js";

const spy = vi.fn();
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  botTokensSince: (...args: unknown[]) => spy(...args),
}));

const prisma = {} as PrismaClient;

describe("botMonthUsage", () => {
  it.each([null, undefined, 0n, -5n])("does not query a bot whose limit is %s", async (limit) => {
    spy.mockClear();
    await expect(botMonthUsage(prisma, { id: "bot-1", monthlyTokenLimit: limit })).resolves.toEqual(
      { used: 0, limit: null },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("sums the bot's tokens from the start of the UTC month", async () => {
    spy.mockReset();
    spy.mockResolvedValue(1_234);
    const now = new Date("2026-11-10T12:00:00Z");
    await expect(
      botMonthUsage(prisma, { id: "bot-1", monthlyTokenLimit: 2_000_000n }, now),
    ).resolves.toEqual({ used: 1_234, limit: 2_000_000 });
    expect(spy).toHaveBeenCalledWith(prisma, "bot-1", utcMonthStart(now));
  });
});
