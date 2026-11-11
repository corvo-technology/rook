import { QuotaWindowSchema } from "@corvo/contracts";
import { redactSecrets } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { managedBotsWhere } from "./child-bots.js";
import type { FleetRun } from "./fleet-tools.js";

const BOT_LIMIT = 40;
const ROUTINE_LIMIT = 50;
const ERROR_LENGTH = 200;
const QUOTA_ALERT_PERCENT = 80;

export type SpaceStatus = {
  bots: Array<{
    bot_id: string;
    name: string;
    model: string;
    last_run: { status: string; at: string; error: string | null } | null;
    pending_approvals: number;
  }>;
  connections_down: Array<{ name: string; provider: string; status: "error" }>;
  servers_failing: Array<{ name: string; message: string | null; checked_at: string | null }>;
  routines_failing: Array<{
    routine_id: string;
    name: string;
    agent: string;
    last_run: string;
    error: string | null;
  }>;
  limits: Array<{
    provider: string;
    window: string;
    used_percent: number;
    resets_at: string | null;
  }>;
  truncated: boolean;
};

/** One short line of outside text with the run's secrets removed. */
function brief(value: string | null, secrets: readonly string[]): string | null {
  if (value === null) return null;
  const line = redactSecrets(value, [...secrets])
    .replace(/\s+/g, " ")
    .trim();
  return line.length > ERROR_LENGTH ? `${line.slice(0, ERROR_LENGTH)}…` : line;
}

/**
 * How the space is doing: models, last run results, apps in error and limits nearly reached, for
 * the caller's space and user. It selects settings, statuses and error text only, never
 * message text, task or routine prompts, memory, wiki or ticket content. Read-only.
 */
export async function spaceStatus(
  deps: { prisma: PrismaClient },
  run: FleetRun,
  secrets: readonly string[],
): Promise<SpaceStatus> {
  const { prisma } = deps;
  const { spaceId, userId } = run;
  const managed = { ...managedBotsWhere(run), archivedAt: null };

  const [botRows, connections, servers, routines, quotas] = await Promise.all([
    prisma.bot.findMany({
      where: managed,
      select: { id: true, name: true, modelProvider: true, modelId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: BOT_LIMIT + 1,
    }),
    prisma.connection.findMany({
      where: { spaceId, userId, status: "error" },
      select: { displayName: true, provider: true },
      orderBy: { id: "asc" },
    }),
    prisma.mcpServer.findMany({
      where: { spaceId, userId, enabled: true, healthStatus: "error" },
      select: { name: true, healthMessage: true, healthCheckedAt: true },
      orderBy: { id: "asc" },
    }),
    prisma.routine.findMany({
      where: { spaceId, active: true, bot: managed },
      select: { id: true, name: true, bot: { select: { name: true } } },
      orderBy: { id: "asc" },
      take: ROUTINE_LIMIT,
    }),
    prisma.providerQuota.findMany({
      where: { spaceId, userId },
      select: { provider: true, windows: true },
      orderBy: { provider: "asc" },
    }),
  ]);

  const bots = botRows.slice(0, BOT_LIMIT);
  const botIds = bots.map((bot) => bot.id);
  const routineIds = routines.map((routine) => routine.id);
  const [botRuns, effects, routineRuns] = await Promise.all([
    botIds.length
      ? prisma.run.findMany({
          where: { spaceId, botId: { in: botIds } },
          select: { botId: true, status: true, createdAt: true, error: true },
          orderBy: [{ botId: "asc" }, { createdAt: "desc" }],
          distinct: ["botId"],
        })
      : [],
    botIds.length
      ? prisma.externalEffect.findMany({
          where: {
            spaceId,
            status: "intended",
            run: { botId: { in: botIds }, status: "waiting_input" },
          },
          select: { run: { select: { botId: true } } },
        })
      : [],
    routineIds.length
      ? prisma.run.findMany({
          where: { spaceId, routineId: { in: routineIds }, trigger: "routine" },
          select: { routineId: true, status: true, createdAt: true, error: true },
          orderBy: [{ routineId: "asc" }, { createdAt: "desc" }],
          distinct: ["routineId"],
        })
      : [],
  ]);

  const lastRunByBot = new Map(botRuns.map((last) => [last.botId, last]));
  const pendingByBot = new Map<string, number>();
  for (const effect of effects) {
    pendingByBot.set(effect.run.botId, (pendingByBot.get(effect.run.botId) ?? 0) + 1);
  }
  const lastRunByRoutine = new Map(routineRuns.map((last) => [last.routineId, last]));

  return {
    bots: bots.map((bot) => {
      const last = lastRunByBot.get(bot.id);
      return {
        bot_id: bot.id,
        name: bot.name,
        model:
          bot.modelProvider && bot.modelId
            ? `${bot.modelProvider}/${bot.modelId}`
            : "space default",
        last_run: last
          ? {
              status: last.status,
              at: last.createdAt.toISOString(),
              error: brief(last.error, secrets),
            }
          : null,
        pending_approvals: pendingByBot.get(bot.id) ?? 0,
      };
    }),
    connections_down: connections.map((connection) => ({
      name: connection.displayName,
      provider: connection.provider,
      status: "error" as const,
    })),
    servers_failing: servers.map((server) => ({
      name: server.name,
      message: brief(server.healthMessage, secrets),
      checked_at: server.healthCheckedAt?.toISOString() ?? null,
    })),
    routines_failing: routines.flatMap((routine) => {
      const last = lastRunByRoutine.get(routine.id);
      if (last?.status !== "failed") return [];
      return [
        {
          routine_id: routine.id,
          name: routine.name,
          agent: routine.bot.name,
          last_run: last.createdAt.toISOString(),
          error: brief(last.error, secrets),
        },
      ];
    }),
    limits: quotas.flatMap((quota) => {
      const windows = QuotaWindowSchema.array().safeParse(quota.windows);
      if (!windows.success) return [];
      return windows.data
        .filter((window) => window.usedPercent >= QUOTA_ALERT_PERCENT)
        .map((window) => ({
          provider: quota.provider,
          window: window.key,
          used_percent: window.usedPercent,
          resets_at: window.resetsAt,
        }));
    }),
    truncated: botRows.length > BOT_LIMIT,
  };
}
