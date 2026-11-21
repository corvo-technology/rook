import { RoutineWatchSchema } from "@corvo/contracts";
import {
  CHIEF_WATCH_EVERY_MINUTES,
  CHIEF_WATCH_PROMPT,
  CHIEF_WATCH_ROUTINE_NAME,
  CHIEF_WATCH_TEMPLATE_KEY,
} from "@corvo/core";
import type { Prisma, PrismaClient } from "./client.js";
import { CHIEF_SPAWN_KEY } from "./starter-team.js";

type Chief = { id: string; spaceId: string; userId: string };

const FIRST_CHECK_DELAY_MS = 60_000;

/**
 * The Chief's default watch routine: a change check on the board every half hour that starts a
 * run only when something changed. Made by the system, so it does not wait for an approval. Safe
 * to repeat: the bot's template key is unique, and `chiefWatchAt` records that it was set up, so
 * a routine the person deleted is not made again.
 */
export async function ensureChiefWatch(
  prisma: Pick<PrismaClient, "routine" | "bot" | "user">,
  chief: Chief,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: chief.userId },
    select: { timezone: true },
  });
  const watch = RoutineWatchSchema.parse({
    kind: "board",
    everyMinutes: CHIEF_WATCH_EVERY_MINUTES,
  });
  let created = true;
  try {
    await prisma.routine.create({
      data: {
        spaceId: chief.spaceId,
        botId: chief.id,
        userId: chief.userId,
        name: CHIEF_WATCH_ROUTINE_NAME,
        prompt: CHIEF_WATCH_PROMPT,
        crons: [],
        timezone: user?.timezone || "UTC",
        notify: true,
        active: true,
        watch: watch as Prisma.InputJsonValue,
        templateKey: CHIEF_WATCH_TEMPLATE_KEY,
        // The job reconciler wakes any active routine that is due.
        nextRunAt: new Date(now.getTime() + FIRST_CHECK_DELAY_MS),
      },
    });
  } catch (error) {
    // Another request made it first: the unique (bot, template key) pair.
    if ((error as { code?: string }).code !== "P2002") throw error;
    created = false;
  }
  await prisma.bot.update({ where: { id: chief.id }, data: { chiefWatchAt: now } });
  return { created };
}

/** Give every Chief without a watch one: the backfill for Chiefs made before it existed. */
export async function ensureChiefWatches(
  prisma: PrismaClient,
  options: { limit?: number; now?: Date } = {},
): Promise<number> {
  const chiefs = await prisma.bot.findMany({
    where: { spawnKey: CHIEF_SPAWN_KEY, archivedAt: null, chiefWatchAt: null },
    select: { id: true, spaceId: true, userId: true },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 50,
  });
  let created = 0;
  for (const chief of chiefs) {
    if ((await ensureChiefWatch(prisma, chief, options.now)).created) created++;
  }
  return created;
}

/** The periodic backfill: a cheap lookup at most this often, and nothing to do once every Chief has its watch. */
export const CHIEF_WATCH_SWEEP_MS = 10 * 60_000;

export function createChiefWatchReconciler(
  prisma: PrismaClient,
  intervalMs = CHIEF_WATCH_SWEEP_MS,
): () => Promise<void> {
  let last = 0;
  return async () => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    await ensureChiefWatches(prisma);
  };
}
