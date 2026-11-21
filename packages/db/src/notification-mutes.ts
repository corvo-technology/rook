import type { MuteDuration, NotificationMute } from "@corvo/contracts";
import { DEFAULT_QUIET_HOURS, muteUntil } from "@corvo/core";
import type { PrismaClient } from "./client.js";

type Target = { botId: string; threadId?: undefined } | { threadId: string; botId?: undefined };
type Person = { spaceId: string; userId: string };

const keyOf = (target: Target) =>
  target.botId ? `bot:${target.botId}` : `thread:${target.threadId}`;

function dto(row: { targetKey: string; until: Date | null }): NotificationMute {
  const [kind, id] = row.targetKey.split(":") as [string, string];
  return {
    botId: kind === "bot" ? id : null,
    threadId: kind === "thread" ? id : null,
    until: row.until?.toISOString() ?? null,
  };
}

/** The person's mutes still running in this space; ended ones are left out. */
export async function listMutes(
  prisma: PrismaClient,
  person: Person,
  now = new Date(),
): Promise<NotificationMute[]> {
  const rows = await prisma.notificationMute.findMany({
    where: { ...person, OR: [{ until: null }, { until: { gt: now } }] },
    select: { targetKey: true, until: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(dto);
}

/** Whether a mute is running now for this agent or this conversation. */
export async function isMuted(
  prisma: PrismaClient,
  run: Person & { botId: string; threadId: string },
  now = new Date(),
): Promise<boolean> {
  const count = await prisma.notificationMute.count({
    where: {
      spaceId: run.spaceId,
      userId: run.userId,
      targetKey: { in: [`bot:${run.botId}`, `thread:${run.threadId}`] },
      OR: [{ until: null }, { until: { gt: now } }],
    },
  });
  return count > 0;
}

/** Silences the pushes of one agent or conversation; a second call replaces the first. */
export async function setMute(
  prisma: PrismaClient,
  person: Person,
  target: Target,
  duration: MuteDuration,
  now = new Date(),
): Promise<NotificationMute> {
  const user = await prisma.user.findUnique({
    where: { id: person.userId },
    select: {
      timezone: true,
      quietHoursEnabled: true,
      quietHoursStart: true,
      quietHoursEnd: true,
    },
  });
  const quiet = user
    ? { enabled: user.quietHoursEnabled, start: user.quietHoursStart, end: user.quietHoursEnd }
    : DEFAULT_QUIET_HOURS;
  const until = muteUntil(duration, quiet, user?.timezone ?? "UTC", now);
  const row = await prisma.notificationMute.upsert({
    where: { userId_targetKey: { userId: person.userId, targetKey: keyOf(target) } },
    create: { ...person, targetKey: keyOf(target), until },
    update: { until },
    select: { targetKey: true, until: true },
  });
  return dto(row);
}

export async function clearMute(prisma: PrismaClient, person: Person, target: Target) {
  await prisma.notificationMute.deleteMany({
    where: { ...person, targetKey: keyOf(target) },
  });
}
