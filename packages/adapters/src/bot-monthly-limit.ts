import { monthlyCeiling, utcMonthStart } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { botTokensSince } from "@corvo/db";

/** What a bot has used this UTC month against its limit; no query when it has no ceiling. */
export async function botMonthUsage(
  prisma: PrismaClient,
  bot: { id: string; monthlyTokenLimit?: bigint | null },
  now = new Date(),
): Promise<{ used: number; limit: number | null }> {
  const ceiling = monthlyCeiling(
    bot.monthlyTokenLimit == null ? null : Number(bot.monthlyTokenLimit),
  );
  if (!Number.isFinite(ceiling)) return { used: 0, limit: null };
  return { used: await botTokensSince(prisma, bot.id, utcMonthStart(now)), limit: ceiling };
}
