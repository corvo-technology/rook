import type { PrismaClient } from "./generated/prisma/client.js";

/** Tokens a bot has used since `since`: each row counts as `usageTokens` in @corvo/core does. */
export async function botTokensSince(
  prisma: Pick<PrismaClient, "$queryRaw">,
  botId: string,
  since: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ tokens: bigint | null }[]>`
    SELECT SUM(COALESCE("totalTokens", COALESCE("inputTokens", 0) + COALESCE("outputTokens", 0))) AS tokens
    FROM usage_records
    WHERE "botId" = ${botId} AND "createdAt" >= ${since}`;
  return Number(rows[0]?.tokens ?? 0);
}

/** Tokens one run has used, its subagents included. */
export async function runTokens(
  prisma: Pick<PrismaClient, "$queryRaw">,
  runId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ tokens: bigint | null }[]>`
    SELECT SUM(COALESCE("totalTokens", COALESCE("inputTokens", 0) + COALESCE("outputTokens", 0))) AS tokens
    FROM usage_records
    WHERE "runId" = ${runId} OR "parentRunId" = ${runId}`;
  return Number(rows[0]?.tokens ?? 0);
}

/** True for the one caller that moved the bot's warned month to `monthKey`. */
export async function claimBudgetAlert(
  prisma: Pick<PrismaClient, "bot">,
  botId: string,
  monthKey: string,
): Promise<boolean> {
  const claimed = await prisma.bot.updateMany({
    where: { id: botId, OR: [{ budgetAlertMonth: null }, { budgetAlertMonth: { not: monthKey } }] },
    data: { budgetAlertMonth: monthKey },
  });
  return claimed.count === 1;
}
