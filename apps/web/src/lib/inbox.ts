import type { AppNotification } from "@corvo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";
import { rpc } from "./rpc";
import { useSpaceHint } from "./space-hints";

export type InboxGroup = { key: string; unread: boolean; items: AppNotification[] };

/**
 * Entries of one conversation sit together; conversations with something unread come first, and
 * each side keeps the order the server sent (newest first). An entry with no conversation stands alone.
 */
export function groupInbox(items: readonly AppNotification[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const item of items) {
    const key = item.threadId ?? item.id;
    const group = groups.get(key) ?? { key, unread: false, items: [] };
    group.items.push(item);
    if (!item.read) group.unread = true;
    groups.set(key, group);
  }
  const all = [...groups.values()];
  return [...all.filter((group) => group.unread), ...all.filter((group) => !group.unread)];
}

/** Where an entry leads: its channel, agent chat or direct conversation, at the message when known. */
export function inboxPath(item: AppNotification): string | null {
  const params = item.messageId ? `?m=${encodeURIComponent(item.messageId)}` : "";
  if (item.kind === "dm") return item.actor ? `/app/dm/${item.actor.userId}` : null;
  if (item.groupId) return `/app/g/${item.groupId}${params}`;
  if (item.botId) return `/app/${item.botId}${params}`;
  return null;
}

/** "5m", "2h", "3d": the short form of how long ago, in the reader's language. */
export function relativeTime(iso: string, now: number, locale: string): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (seconds < 60) return format.format(0, "second");
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return format.format(-Math.floor(seconds / 3600), "hour");
  return format.format(-Math.floor(seconds / 86_400), "day");
}

/** The caller's inbox, refreshed when the space stream says it changed. */
export function useInbox() {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.inbox.list.queryOptions({ input: {} });
  const query = useQuery({ ...options, refetchOnWindowFocus: true });
  useSpaceHint("notifications", () => void query.refetch());
  const refresh = () => queryClient.invalidateQueries({ queryKey: options.queryKey });
  return {
    items: query.data?.items ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    markRead: (ids: string[]) => rpc.inbox.markRead({ ids }).then(refresh, () => undefined),
    markAllRead: () => rpc.inbox.markAllRead().then(refresh, () => undefined),
  };
}
