import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { unavailableAgents } from "./routing-availability.js";

function db(options: {
  pausedAt?: Date | null;
  bots?: Array<{ id: string; dailyCapMicros: bigint | null; monthlyTokenLimit: bigint | null }>;
  spentMicros?: bigint;
  monthTokens?: number;
}) {
  return {
    space: { findUnique: vi.fn().mockResolvedValue({ pausedAt: options.pausedAt ?? null }) },
    bot: { findMany: vi.fn().mockResolvedValue(options.bots ?? []) },
    // The daily cap reads `spent`, the month reads `tokens`; one row answers whichever is asked.
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { spent: options.spentMicros ?? 0n, tokens: BigInt(options.monthTokens ?? 0) },
      ]),
  } as unknown as PrismaClient;
}

describe("unavailableAgents", () => {
  it("marks every agent paused when the owner paused the space", async () => {
    const result = await unavailableAgents(db({ pausedAt: new Date() }), "space-1", ["a", "b"]);
    expect([...result]).toEqual([
      ["a", "paused"],
      ["b", "paused"],
    ]);
  });

  it("marks an agent over its daily cap", async () => {
    const result = await unavailableAgents(
      db({
        bots: [{ id: "a", dailyCapMicros: 1_000n, monthlyTokenLimit: null }],
        spentMicros: 1_000n,
      }),
      "space-1",
      ["a", "b"],
    );
    expect([...result]).toEqual([["a", "over_budget"]]);
  });

  it("marks an agent over its monthly token limit", async () => {
    const result = await unavailableAgents(
      db({
        bots: [{ id: "a", dailyCapMicros: null, monthlyTokenLimit: 1_000n }],
        monthTokens: 5_000,
      }),
      "space-1",
      ["a"],
    );
    expect([...result]).toEqual([["a", "over_budget"]]);
  });

  it("leaves an agent with room alone", async () => {
    const result = await unavailableAgents(
      db({
        bots: [{ id: "a", dailyCapMicros: 1_000n, monthlyTokenLimit: 10_000n }],
        spentMicros: 10n,
        monthTokens: 100,
      }),
      "space-1",
      ["a"],
    );
    expect(result.size).toBe(0);
  });
});
