import type { AppNotification } from "@corvo/contracts";
import { expect, it } from "vitest";
import { groupInbox, inboxPath, relativeTime } from "./inbox";

function entry(id: string, over: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: "mention",
    threadId: null,
    groupId: null,
    messageId: null,
    botId: null,
    source: "general",
    actor: null,
    preview: null,
    detail: null,
    read: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

it("groups by conversation, unread conversations first, keeping the server order", () => {
  const groups = groupInbox([
    entry("a", { threadId: "t1", read: true }),
    entry("b", { threadId: "t2" }),
    entry("c", { threadId: "t1" }),
    entry("d", { threadId: "t3", read: true }),
    entry("e"),
  ]);
  expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
    ["a", "c"],
    ["b"],
    ["e"],
    ["d"],
  ]);
  expect(groups.map((group) => group.unread)).toEqual([true, true, true, false]);
});

it("leads to the channel, the agent chat or the person, at the message when known", () => {
  expect(inboxPath(entry("a", { groupId: "g1", messageId: "m1" }))).toBe("/app/g/g1?m=m1");
  expect(inboxPath(entry("a", { botId: "b1" }))).toBe("/app/b1");
  expect(
    inboxPath(entry("a", { kind: "dm", actor: { userId: "u1", name: "Ana", image: null } })),
  ).toBe("/app/dm/u1");
  expect(inboxPath(entry("a", { kind: "alert" }))).toBeNull();
});

it("shortens how long ago", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  expect(relativeTime("2026-01-01T11:55:00.000Z", now, "en")).toMatch(/5/);
  expect(relativeTime("2026-01-01T09:00:00.000Z", now, "en")).toMatch(/3/);
  expect(relativeTime("2025-12-29T12:00:00.000Z", now, "en")).toMatch(/3/);
});
