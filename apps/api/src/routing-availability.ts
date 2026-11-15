import { botDailyLimitReached, botMonthUsage } from "@corvo/adapters";
import { monthlyLimitReached } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";

/**
 * Of these agents, the ones whose run would stop before the model: the owner paused the space,
 * or the agent used up its daily or monthly budget. The run executor enforces both; this only
 * reads the same limits so the message can say why nobody answered.
 */
export async function unavailableAgents(
  prisma: PrismaClient,
  spaceId: string,
  botIds: readonly string[],
): Promise<Map<string, "paused" | "over_budget">> {
  const unavailable = new Map<string, "paused" | "over_budget">();
  if (botIds.length === 0) return unavailable;
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { pausedAt: true },
  });
  if (space?.pausedAt) {
    for (const id of botIds) unavailable.set(id, "paused");
    return unavailable;
  }
  const bots = await prisma.bot.findMany({
    where: {
      id: { in: [...botIds] },
      spaceId,
      OR: [{ dailyCapMicros: { not: null } }, { monthlyTokenLimit: { gt: 0 } }],
    },
    select: { id: true, dailyCapMicros: true, monthlyTokenLimit: true },
  });
  for (const bot of bots) {
    const month = await botMonthUsage(prisma, bot);
    if ((await botDailyLimitReached(prisma, bot)) || monthlyLimitReached(month.used, month.limit)) {
      unavailable.set(bot.id, "over_budget");
    }
  }
  return unavailable;
}
