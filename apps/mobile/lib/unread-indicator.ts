import { unreadBadgeText } from "@corvo/contracts";

export type UnreadIndicator = { kind: "count"; text: string; mention: boolean } | { kind: "dot" };

/** A count when the server sent one, the plain dot for older servers, nothing when all is read. */
export function unreadIndicator(row: {
  unread?: boolean;
  unreadCount?: number;
  mentionCount?: number;
}): UnreadIndicator | null {
  if (row.unreadCount && row.unreadCount > 0) {
    return {
      kind: "count",
      text: unreadBadgeText(row.unreadCount),
      mention: (row.mentionCount ?? 0) > 0,
    };
  }
  return row.unread ? { kind: "dot" } : null;
}
