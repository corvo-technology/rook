// @vitest-environment jsdom
import type { AppNotification } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InboxPanel } from "./InboxPanel";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    i18n: { locale: "en" },
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

function entry(id: string, over: Partial<AppNotification>): AppNotification {
  return {
    id,
    kind: "mention",
    threadId: null,
    groupId: "g1",
    messageId: null,
    botId: null,
    source: "general",
    actor: null,
    preview: "hello",
    detail: null,
    read: false,
    createdAt: "2026-01-01T11:00:00.000Z",
    ...over,
  };
}

async function render(items: AppNotification[], onOpen = vi.fn(), onMarkAllRead = vi.fn()) {
  const host = document.createElement("div");
  await act(async () =>
    createRoot(host).render(
      <InboxPanel
        items={items}
        unreadCount={items.filter((item) => !item.read).length}
        now={Date.parse("2026-01-01T12:00:00.000Z")}
        onOpen={onOpen}
        onMarkAllRead={onMarkAllRead}
        onActivity={() => {}}
      />,
    ),
  );
  return host;
}

it("lists unread conversations first, shows an alert's detail and opens an entry", async () => {
  const onOpen = vi.fn();
  const items = [
    entry("read", { read: true, source: "ops", threadId: "t1" }),
    entry("alert", { kind: "alert", source: "Budget", preview: null, detail: "Limit reached" }),
  ];
  const host = await render(items, onOpen);
  const rows = [...host.querySelectorAll<HTMLButtonElement>("[data-inbox-item]")];
  expect(rows.map((row) => row.dataset.inboxItem)).toEqual(["unread", "read"]);
  expect(rows[0]?.textContent).toContain("Limit reached");
  await act(async () => rows[0]!.click());
  expect(onOpen).toHaveBeenCalledWith(items[1]);
});

it("marks everything read and says little when empty", async () => {
  const onMarkAllRead = vi.fn();
  const host = await render([entry("a", {})], vi.fn(), onMarkAllRead);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Mark all read"]')!.click(),
  );
  expect(onMarkAllRead).toHaveBeenCalledOnce();
  expect((await render([])).textContent).toContain("All caught up");
});
