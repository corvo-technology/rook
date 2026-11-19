import { PARTNER_EVENT_RETENTION_DAYS, RoutineEventTriggerSchema } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import type { Prisma } from "./generated/prisma/client.js";

const DAY_MS = 24 * 60 * 60_000;

export interface PartnerEventRow {
  partnerId: string;
  externalTenantId: string;
  organizationId: string | null;
  type: string;
  name: string | null;
  status: "accepted" | "rejected";
  error: string | null;
  payload: unknown;
  occurredAt: Date | null;
}

/** Keeps one received event for the retention window. Call with a client that runs as the system. */
export async function recordPartnerEvent(
  prisma: PrismaClient,
  row: PartnerEventRow,
  now = new Date(),
): Promise<{ id: string }> {
  return prisma.partnerEvent.create({
    data: {
      ...row,
      payload: (row.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      expiresAt: new Date(now.getTime() + PARTNER_EVENT_RETENTION_DAYS * DAY_MS),
    },
    select: { id: true },
  });
}

export async function countRecentPartnerEvents(
  prisma: PrismaClient,
  partnerId: string,
  externalTenantId: string,
  since: Date,
): Promise<number> {
  return prisma.partnerEvent.count({
    where: { partnerId, externalTenantId, createdAt: { gte: since } },
  });
}

/**
 * The active routines of one customer that an event of this kind may start. A routine whose
 * trigger no longer parses is left out. Filters are applied by the caller.
 */
export async function findEventRoutines(
  prisma: PrismaClient,
  organizationId: string,
  trigger: { type: string; name?: string },
) {
  const rows = await prisma.routine.findMany({
    where: {
      spaceId: organizationId,
      active: true,
      bot: { archivedAt: null },
      eventTrigger: { path: ["type"], equals: trigger.type },
    },
    select: {
      id: true,
      name: true,
      prompt: true,
      modelProvider: true,
      modelId: true,
      thinkingLevel: true,
      eventTrigger: true,
      bot: { select: { id: true, spaceId: true, userId: true, thread: { select: { id: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return rows.flatMap((row) => {
    const parsed = RoutineEventTriggerSchema.safeParse(row.eventTrigger);
    if (!parsed.success) return [];
    if (trigger.type === "custom" && parsed.data.name !== trigger.name) return [];
    const { eventTrigger: _trigger, bot, ...routine } = row;
    return [{ ...routine, trigger: parsed.data, bot, threadId: bot.thread?.id ?? null }];
  });
}

export async function settlePartnerEvent(
  prisma: PrismaClient,
  id: string,
  counts: { matched: number; delivered: number },
): Promise<void> {
  await prisma.partnerEvent.update({ where: { id }, data: counts });
}

export async function purgeExpiredPartnerEvents(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  return (await prisma.partnerEvent.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}

/** What a partner's console shows of the last day: counts, types and the latest events. */
export async function summarizePartnerEvents(prisma: PrismaClient, partnerId: string, now: Date) {
  const since = new Date(now.getTime() - DAY_MS);
  const [groups, recent] = await Promise.all([
    prisma.partnerEvent.groupBy({
      by: ["type", "status"],
      where: { partnerId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.partnerEvent.findMany({
      where: { partnerId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        externalTenantId: true,
        type: true,
        status: true,
        error: true,
        matched: true,
        payload: true,
        createdAt: true,
      },
    }),
  ]);
  return { groups, recent };
}

/** When events last started a routine in a customer's space, by event type and custom name. */
export async function lastEventsByType(
  prisma: PrismaClient,
  organizationId: string,
): Promise<Map<string, Date>> {
  const rows = await prisma.partnerEvent.groupBy({
    by: ["type", "name"],
    where: { organizationId, status: "accepted", matched: { gt: 0 } },
    _max: { createdAt: true },
  });
  return new Map(
    rows.flatMap((row) =>
      row._max.createdAt ? [[`${row.type}:${row.name ?? ""}`, row._max.createdAt] as const] : [],
    ),
  );
}
