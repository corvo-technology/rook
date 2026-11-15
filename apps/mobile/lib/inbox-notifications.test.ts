import type { AppNotification } from "@corvo/contracts";
import { unreadBadgeText } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import type { InboxEntry } from "./inbox-notifications";
import { groupInbox, inboxKindCue, inboxMarkRead, inboxRoute } from "./inbox-notifications";
import { notificationOpenTarget } from "./notification-open";
import { unreadIndicator } from "./unread-indicator";

function item(over: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    kind: "mention",
    threadId: "t1",
    groupId: null,
    messageId: null,
    botId: null,
    source: "general",
    actor: null,
    preview: null,
    detail: null,
    read: false,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...over,
  };
}

describe("unread indicator", () => {
  it("shows a count, capped at 99+, with mentions flagged", () => {
    expect(unreadIndicator({ unread: true, unreadCount: 7 })).toEqual({
      kind: "count",
      text: "7",
      mention: false,
    });
    expect(unreadIndicator({ unread: true, unreadCount: 100, mentionCount: 2 })).toEqual({
      kind: "count",
      text: unreadBadgeText(100),
      mention: true,
    });
    expect(unreadBadgeText(100)).toBe("99+");
  });

  it("falls back to the dot, and to nothing when all is read", () => {
    expect(unreadIndicator({ unread: true })).toEqual({ kind: "dot" });
    expect(unreadIndicator({ unread: true, unreadCount: 0 })).toEqual({ kind: "dot" });
    expect(unreadIndicator({ unread: false })).toBeNull();
  });
});

describe("message push routing", () => {
  it("treats an empty botId as absent and opens the channel", () => {
    expect(
      notificationOpenTarget({
        kind: "message",
        botId: "",
        groupId: "g1",
        threadId: "t1",
        spaceId: "s1",
      }),
    ).toEqual({
      pathname: "/group-thread",
      params: { groupId: "g1", threadId: "t1", spaceId: "s1" },
    });
  });

  it("opens nothing for a DM or alert push with neither group nor bot", () => {
    expect(
      notificationOpenTarget({ kind: "message", botId: "", threadId: "t1", spaceId: "s1" }),
    ).toBeNull();
  });
});

describe("inbox routes", () => {
  it("opens a channel, an agent chat, and nothing for a DM or an alert", () => {
    expect(inboxRoute(item({ groupId: "g1" }))).toEqual({
      pathname: "/group-thread",
      params: { groupId: "g1", threadId: "t1", name: "general" },
    });
    expect(inboxRoute(item({ botId: "b1", source: "Ada" }))).toEqual({
      pathname: "/thread",
      params: { botId: "b1", threadId: "t1", name: "Ada" },
    });
    expect(inboxRoute(item({ kind: "dm", botId: "b1" }))).toBeNull();
    expect(inboxRoute(item({ kind: "alert", threadId: null }))).toBeNull();
  });
});

describe("inbox grouping", () => {
  it("makes one row per conversation, unread first, newest first", () => {
    const rows = groupInbox([
      item({ id: "a", threadId: "t1", read: true, createdAt: "2026-01-03T00:00:00.000Z" }),
      item({ id: "b", threadId: "t2", createdAt: "2026-01-01T00:00:00.000Z" }),
      item({ id: "c", threadId: "t2", createdAt: "2026-01-02T00:00:00.000Z" }),
      item({ id: "d", threadId: null, kind: "alert", createdAt: "2026-01-04T00:00:00.000Z" }),
    ]);
    expect(rows.map((row) => row.latest.id)).toEqual(["d", "c", "a"]);
    expect(rows[1]?.unreadIds.sort()).toEqual(["b", "c"]);
  });

  it("marks a conversation by thread, a lone entry by id, and a read row not at all", () => {
    const [row, alert, read] = groupInbox([
      item({ id: "a", threadId: "t1", createdAt: "2026-01-03T00:00:00.000Z" }),
      item({ id: "d", threadId: null, kind: "alert", createdAt: "2026-01-02T00:00:00.000Z" }),
      item({ id: "r", threadId: "t9", read: true, createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(inboxMarkRead(row as InboxEntry)).toEqual({ threadId: "t1" });
    expect(inboxMarkRead(alert as InboxEntry)).toEqual({ ids: ["d"] });
    expect(inboxMarkRead(read as InboxEntry)).toBeNull();
  });

  it("gives every kind a cue", () => {
    expect(inboxKindCue("mention", (m) => m)).toBe("Mention");
    expect(inboxKindCue("failure", (m) => m)).toBe("Failed");
  });
});
