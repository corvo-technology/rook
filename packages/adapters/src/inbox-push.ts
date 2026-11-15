import type { NotificationKind } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describeNotifications, runAsSystem, runAsTenant } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { ExpoPushProvider } from "./expo-push.js";

/**
 * Kinds this path pushes. Approvals, questions and failures already reach the phone from the run
 * that raised them, so the inbox row is recorded for them and the push is not repeated.
 */
const PUSHED: ReadonlySet<NotificationKind> = new Set(["mention", "reply", "dm", "alert"]);

/**
 * Sends the push for one inbox entry, if it is still unread a moment after it was raised and the
 * member has a device. Which devices and how a push is delivered stay inside the provider.
 */
export function createInboxPushSink(prisma: PrismaClient, push: ExpoPushProvider) {
  return async (notificationId: string): Promise<void> => {
    try {
      const row = await runAsSystem("read an inbox entry to push it", () =>
        prisma.notification.findUnique({ where: { id: notificationId } }),
      );
      if (!row || row.readAt || !PUSHED.has(row.kind as NotificationKind)) return;
      if (!(await push.hasPushRecipient(row.userId))) return;
      const [item] = await runAsTenant({ spaceId: row.spaceId, userId: row.userId }, () =>
        describeNotifications(prisma, row.spaceId, [row]),
      );
      if (!item) return;
      const who = item.actor?.name;
      const title =
        item.kind === "dm" ? (who ?? item.source) : [who, item.source].filter(Boolean).join(" · ");
      await push.send(
        {
          kind: "message",
          title,
          body: item.preview ?? item.detail ?? "",
          botId: row.botId ?? "",
          threadId: row.threadId ?? row.id,
          ...(item.groupId ? { groupId: item.groupId } : {}),
        },
        {
          operationId: "notify.inbox",
          traceId: row.id,
          spaceId: row.spaceId,
          userId: row.userId,
          signal: new AbortController().signal,
        },
      );
    } catch (error) {
      getLogger().error("inbox push", error);
    }
  };
}
