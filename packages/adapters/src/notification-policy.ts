import type { JobPublisher, NotificationMessage, NotificationProvider } from "@corvo/adapter-kit";
import { notificationDigestJob } from "@corvo/adapter-kit";
import {
  DAILY_PROACTIVE_PUSH_CAP,
  DEFAULT_QUIET_HOURS,
  digestPush,
  isProactiveRunTrigger,
  isQuietNow,
  localDay,
  nextDigestTime,
} from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { countUnreadInboxChats, isMuted, runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";

/** How a background run asks for its push to be treated; a normal push says nothing. */
export type NotifyPriority = "urgent" | "low";

export type PushVerdict = "send" | "muted" | "held";

type PolicyRun = {
  spaceId: string;
  userId: string;
  botId: string;
  threadId: string;
  trigger: string;
};

type PolicyDeps = { prisma: PrismaClient; jobs?: JobPublisher };

/** The pushes a person's night and daily cap hold back. A question or a live takeover waits on them now. */
function holdable(message: NotificationMessage): boolean {
  return message.kind === "completion" || message.kind === "failure";
}

/**
 * Decides one push of a run: silenced by a mute, held for the morning digest, or sent now.
 * A mute silences everything the agent or conversation pushes. Quiet hours, the daily cap and the
 * digest apply only to the results of background runs that no person started; urgent skips the
 * hold and the cap, and low goes straight to the digest.
 */
export async function decidePush(
  deps: PolicyDeps,
  run: PolicyRun,
  message: NotificationMessage,
  priority: NotifyPriority | null | undefined,
  now = new Date(),
): Promise<PushVerdict> {
  if (await isMuted(deps.prisma, run, now)) return "muted";
  if (!isProactiveRunTrigger(run.trigger) || !holdable(message) || priority === "urgent") {
    return "send";
  }
  const user = await deps.prisma.user.findUnique({
    where: { id: run.userId },
    select: {
      timezone: true,
      quietHoursEnabled: true,
      quietHoursStart: true,
      quietHoursEnd: true,
    },
  });
  const quiet = user
    ? {
        enabled: user.quietHoursEnabled,
        start: user.quietHoursStart,
        end: user.quietHoursEnd,
      }
    : DEFAULT_QUIET_HOURS;
  const timezone = user?.timezone ?? "UTC";
  let reason: "low" | "quiet" | "cap" | null = null;
  if (priority === "low") reason = "low";
  else if (isQuietNow(quiet, timezone, now)) reason = "quiet";
  else if (
    (await countProactivePush(deps.prisma, run, localDay(now, timezone))) > DAILY_PROACTIVE_PUSH_CAP
  ) {
    reason = "cap";
  }
  if (!reason) return "send";
  const releaseAt = nextDigestTime(quiet, timezone, now);
  await deps.prisma.heldNotification.create({
    data: {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: run.botId,
      message: message as object,
      reason,
      releaseAt,
    },
  });
  // The earliest morning anything waits for, so a changed timezone never pushes an older item back.
  const earliest = await deps.prisma.heldNotification.aggregate({
    where: { userId: run.userId },
    _min: { releaseAt: true },
  });
  await deps.jobs
    ?.enqueue(notificationDigestJob(run.userId, earliest._min.releaseAt ?? releaseAt))
    .catch((error) => getLogger().error("notification digest enqueue", error));
  return "held";
}

/** Counts this push against the agent's day and returns how many it has sent, this one included. */
async function countProactivePush(
  prisma: PrismaClient,
  run: Pick<PolicyRun, "spaceId" | "userId" | "botId">,
  day: string,
): Promise<number> {
  const row = await prisma.proactivePushCount.upsert({
    where: { userId_botId_day: { userId: run.userId, botId: run.botId, day } },
    create: { spaceId: run.spaceId, userId: run.userId, botId: run.botId, day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return row.count;
}

type DigestDeps = {
  prisma: PrismaClient;
  jobs: JobPublisher;
  notifications?: Pick<NotificationProvider, "send">;
};

/**
 * Sends what waited for the morning as one push: the push itself when one thing waited, a count
 * and the agents' names when several did. Whatever has been muted since is dropped. Rows leave
 * only after the send, so a failed send is retried by the job.
 */
export async function deliverDigest(
  deps: DigestDeps,
  userId: string,
  now = new Date(),
): Promise<void> {
  await runAsSystem("deliver a notification digest", async () => {
    const rows = await deps.prisma.heldNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const due = rows.filter((row) => row.releaseAt <= now);
    const later = rows.find((row) => row.releaseAt > now);
    if (later) {
      await deps.jobs
        .enqueue(notificationDigestJob(userId, later.releaseAt))
        .catch((error) => getLogger().error("notification digest enqueue", error));
    }
    if (due.length === 0) return;
    const live = [];
    for (const row of due) {
      const message = row.message as unknown as NotificationMessage;
      if (!(await isMuted(deps.prisma, { ...row, threadId: message.threadId }, now))) {
        live.push({ row, message });
      }
    }
    const newest = live.at(-1);
    if (newest && deps.notifications) {
      const { row, message } = newest;
      const user = await deps.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true },
      });
      const bots = await deps.prisma.bot.findMany({
        where: { id: { in: live.map((item) => item.row.botId) } },
        select: { id: true, name: true },
      });
      const names = new Map(bots.map((bot) => [bot.id, bot.name]));
      const summary =
        live.length === 1
          ? message
          : {
              ...message,
              kind: "completion" as const,
              ...digestPush(
                live.length,
                live.map((item) => names.get(item.row.botId) ?? "").filter(Boolean),
                user?.locale ?? undefined,
              ),
            };
      const badge = await countUnreadInboxChats(deps.prisma, {
        userId,
        spaceId: row.spaceId,
      }).catch(() => undefined);
      await deps.notifications.send(
        { ...summary, ...(badge === undefined ? {} : { badge }) },
        {
          operationId: "notification-digest",
          traceId: row.botId,
          spaceId: row.spaceId,
          userId,
          botId: row.botId,
          signal: new AbortController().signal,
        },
      );
    }
    await deps.prisma.heldNotification.deleteMany({
      where: { id: { in: due.map((row) => row.id) } },
    });
  });
}
