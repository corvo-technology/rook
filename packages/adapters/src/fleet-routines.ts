import { formatCron } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { managedRoutinesWhere } from "./child-bots.js";
import type { FleetRun } from "./fleet-tools.js";

const ROUTINE_LIMIT = 50;
const EXCERPT_LENGTH = 240;

function excerpt(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > EXCERPT_LENGTH ? `${line.slice(0, EXCERPT_LENGTH)}…` : line;
}

export interface RoutineListing {
  routines: Array<{
    routine_id: string;
    agent: string;
    agent_id: string;
    name: string;
    /** The start of what the routine asks its agent, enough to tell two routines apart. */
    prompt: string;
    /** The steps after the first, in the order they run. */
    steps: Array<{ position: number; agent: string; instruction: string }>;
    schedule: string;
    timezone: string;
    active: boolean;
    next_run: string | null;
    last_run: string | null;
    last_result: string | null;
  }>;
  truncated: boolean;
}

/**
 * Every routine the person asking may see (the space's with `manage_routines`, else their own), so they can be told what is scheduled and
 * how the last run went without opening each agent. Read-only.
 */
export async function listRoutines(
  deps: { prisma: PrismaClient },
  run: FleetRun,
): Promise<RoutineListing> {
  const rows = await deps.prisma.routine.findMany({
    where: managedRoutinesWhere(run),
    select: {
      id: true,
      name: true,
      prompt: true,
      steps: {
        orderBy: { position: "asc" },
        select: { position: true, instruction: true, bot: { select: { name: true } } },
      },
      crons: true,
      timezone: true,
      active: true,
      nextRunAt: true,
      lastRunAt: true,
      watch: true,
      webhookEnabled: true,
      githubEnabled: true,
      bot: { select: { id: true, name: true } },
    },
    orderBy: [{ active: "desc" }, { nextRunAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: ROUTINE_LIMIT + 1,
  });
  const shown = rows.slice(0, ROUTINE_LIMIT);
  const lastRuns = shown.length
    ? await deps.prisma.run.findMany({
        where: { routineId: { in: shown.map((row) => row.id) }, trigger: "routine" },
        select: { routineId: true, status: true },
        orderBy: [{ routineId: "asc" }, { createdAt: "desc" }],
        distinct: ["routineId"],
      })
    : [];
  const resultByRoutine = new Map(lastRuns.map((last) => [last.routineId, last.status]));
  return {
    routines: shown.map((row) => ({
      routine_id: row.id,
      agent: row.bot.name,
      agent_id: row.bot.id,
      name: row.name,
      prompt: excerpt(row.prompt),
      steps: row.steps.map((step) => ({
        position: step.position,
        agent: step.bot.name,
        instruction: excerpt(step.instruction),
      })),
      schedule: row.watch
        ? "when something changes"
        : row.crons.length > 0
          ? row.crons.map((cron) => formatCron(cron)).join("; ")
          : row.webhookEnabled || row.githubEnabled
            ? "when triggered from outside"
            : "none",
      timezone: row.timezone,
      active: row.active,
      next_run: row.nextRunAt?.toISOString() ?? null,
      last_run: row.lastRunAt?.toISOString() ?? null,
      last_result: resultByRoutine.get(row.id) ?? null,
    })),
    truncated: rows.length > ROUTINE_LIMIT,
  };
}
