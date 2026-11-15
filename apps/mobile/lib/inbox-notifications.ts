import type { AppNotification, NotificationKind } from "@corvo/contracts";
import type { NotificationRoute } from "./notification-open";
import { notificationOpenTarget } from "./notification-open";

export type InboxEntry = {
  key: string;
  /** The unread entries this row stands for. */
  unreadIds: string[];
  /** Set when the row is a whole conversation. */
  threadId: string | null;
  latest: AppNotification;
  unread: boolean;
};

/** One row per conversation (the newest entry speaks for it), unread first, then newest first. */
export function groupInbox(items: readonly AppNotification[]): InboxEntry[] {
  const groups = new Map<string, AppNotification[]>();
  for (const item of items) {
    const key = item.threadId ?? item.id;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const rows = [...groups].flatMap(([key, list]): InboxEntry[] => {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sorted[0];
    if (!latest) return [];
    const unreadIds = sorted.filter((item) => !item.read).map((item) => item.id);
    return [{ key, unreadIds, threadId: latest.threadId, latest, unread: unreadIds.length > 0 }];
  });
  return rows.sort(
    (a, b) =>
      Number(b.unread) - Number(a.unread) || b.latest.createdAt.localeCompare(a.latest.createdAt),
  );
}

/** Channels and agent chats open; a person's DM and an alert have no mobile screen. */
export function inboxRoute(item: AppNotification): NotificationRoute | null {
  if (item.kind === "dm") return null;
  return notificationOpenTarget({
    groupId: item.groupId ?? "",
    botId: item.botId ?? "",
    threadId: item.threadId ?? "",
    name: item.source,
  });
}

/** What marks the row read: the whole conversation, or just its unread entries. */
export function inboxMarkRead(entry: InboxEntry): { threadId: string } | { ids: string[] } | null {
  if (!entry.unread) return null;
  return entry.threadId ? { threadId: entry.threadId } : { ids: entry.unreadIds };
}

/** The short word beside the actor: what kind of entry this is. */
export function inboxKindCue(kind: NotificationKind, t: (message: string) => string): string {
  switch (kind) {
    case "mention":
      return t("Mention");
    case "reply":
      return t("Reply");
    case "dm":
      return t("Message");
    case "approval":
      return t("Approval");
    case "question":
      return t("Question");
    case "failure":
      return t("Failed");
    case "alert":
      return t("Alert");
  }
}
