import type { MoneyCap } from "@corvo/core";
import {
  callAmount,
  hasMoneyCap,
  MONEY_TOOL_WORDS,
  moneyCapVerdict,
  toolMovesMoney,
} from "@corvo/core";
import type { RunContext } from "./run-context.js";
import { PASSED_EFFECT_STATUSES } from "./run-effects.js";

/** More effects than this in a month and the total is not trusted: the call asks. */
const MAX_MONTH_EFFECTS = 2_000;

export function botMoneyCap(bot: {
  moneyCapPerCall?: number | null;
  moneyCapPerMonth?: number | null;
}): MoneyCap {
  return { perCall: bot.moneyCapPerCall ?? null, perMonth: bot.moneyCapPerMonth ?? null };
}

/** The start of the current calendar month, UTC. */
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * What this agent's payment calls moved this calendar month: the amounts of the calls that got past
 * their approval gate. A call with no readable amount counts nothing, since it always asked. Null
 * when the total cannot be trusted.
 */
async function movedThisMonth(ctx: RunContext, now: Date): Promise<number | null> {
  const rows = await ctx.deps.prisma.externalEffect.findMany({
    where: {
      run: { botId: ctx.bot.id },
      status: { in: PASSED_EFFECT_STATUSES },
      createdAt: { gte: monthStart(now) },
      OR: MONEY_TOOL_WORDS.map((word) => ({
        kind: { contains: word, mode: "insensitive" as const },
      })),
    },
    select: { kind: true, request: true },
    take: MAX_MONTH_EFFECTS + 1,
  });
  if (rows.length > MAX_MONTH_EFFECTS) return null;
  return rows
    .filter((row) => toolMovesMoney(row.kind, "high"))
    .reduce((sum, row) => sum + (callAmount(row.request) ?? 0), 0);
}

/**
 * Whether a call asks because of the agent's money cap: it moves money, a cap is set, and the call
 * is over it, its amount cannot be read, or this month's total cannot be trusted. A batch of
 * actions has no one amount, so it asks.
 */
export async function overMoneyCap(
  ctx: RunContext,
  call: {
    tools: readonly { name: string; risk: Parameters<typeof toolMovesMoney>[1] }[];
    args: unknown;
    batch: boolean;
  },
  now = new Date(),
): Promise<boolean> {
  const cap = botMoneyCap(ctx.bot);
  if (!hasMoneyCap(cap)) return false;
  if (!call.tools.some((tool) => toolMovesMoney(tool.name, tool.risk))) return false;
  if (call.batch) return true;
  const amount = callAmount(call.args);
  const spent = cap.perMonth !== null && amount !== null ? await movedThisMonth(ctx, now) : 0;
  if (spent === null) return true;
  return moneyCapVerdict({ cap, amount, spentThisMonth: spent }) !== "within";
}
