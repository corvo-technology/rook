// @vitest-environment jsdom
import type { PendingApproval } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
}));
vi.mock("../lib/rpc", () => ({ rpc: {} }));

import { ApprovalsInbox } from "./ApprovalsInbox";
import { SidebarNav } from "./shell/sidebar-team";

const item = (messageId: string, botName: string, groupName?: string): PendingApproval => ({
  runId: `run-${messageId}`,
  messageId,
  botId: `bot-${botName}`,
  botName,
  botColor: "#75aef5",
  groupId: groupName ? `g-${groupName}` : undefined,
  groupName,
  block: {
    kind: "ask",
    text: "Send the report to the accountant",
    approvalEffectId: `effect-${messageId}`,
    actions: [
      { id: "allow", label: "Allow once" },
      { id: "deny", label: "Not now" },
    ],
  },
  createdAt: "2026-11-10T09:00:00.000Z",
});

let host: HTMLDivElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
});

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => createRoot(host!).render(node));
}

it("lists each approval with its agent, where it came from, and the card that decides it", async () => {
  const onOpenChat = vi.fn();
  await mount(
    <ApprovalsInbox
      items={[item("m1", "Cora", "finance"), item("m2", "Bento")]}
      onAnswer={async () => undefined}
      onOpenChat={onOpenChat}
    />,
  );
  const rows = host!.querySelectorAll('[data-testid="approval-item"]');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Cora");
  expect(rows[0]?.textContent).toContain("#finance");
  expect(rows[0]?.textContent).toContain("Send the report to the accountant");
  // A tap does not approve: the card holds to approve, as in the chat.
  expect(rows[0]?.textContent).toContain("Hold to approve");
  await act(async () => rows[0]!.querySelector<HTMLButtonElement>("button")!.click());
  expect(onOpenChat).toHaveBeenCalledWith(expect.objectContaining({ messageId: "m1" }));
});

it("says nothing is waiting when nothing is", async () => {
  await mount(<ApprovalsInbox items={[]} onAnswer={async () => undefined} onOpenChat={vi.fn()} />);
  expect(host!.querySelector('[data-testid="approvals-empty"]')?.textContent).toContain(
    "Nothing to approve",
  );
});

const NAV = [
  { key: "home", label: "Home", to: "/app/bot-1" },
  { key: "approvals", label: "Approvals", to: "/app/approvals", badge: 0 },
  { key: "tasks", label: "Tasks", to: "/app/board" },
  { key: "activity", label: "Activity", to: "/app/activity" },
  { key: "team", label: "Team", to: "/app/team" },
];

const nav = (approvals: number, onOpen = vi.fn()) => (
  <SidebarNav
    items={NAV.map((item) => (item.key === "approvals" ? { ...item, badge: approvals } : item))}
    more={[]}
    pathname="/app/activity"
    onOpen={onOpen}
  />
);

it("keeps Approvals in the sidebar nav, its count shown only while something waits", async () => {
  await mount(nav(3));
  expect(host!.querySelector('[data-testid="sidebar-approvals-count"]')?.textContent).toBe("3");
  await act(async () => createRoot(host!).render(nav(0)));
  expect(host!.querySelector('[data-testid="sidebar-approvals"]')).not.toBeNull();
  expect(host!.querySelector('[data-testid="sidebar-approvals-count"]')).toBeNull();
  expect([...host!.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Home",
    "Approvals",
    "Tasks",
    "Activity",
    "Team",
  ]);
});

it("opens a place from the nav and marks the one that is open", async () => {
  const onOpen = vi.fn();
  await mount(nav(0, onOpen));
  expect(
    host!.querySelector('[data-testid="sidebar-activity"]')?.getAttribute("aria-current"),
  ).toBe("page");
  expect(host!.querySelector('[data-testid="sidebar-team"]')?.getAttribute("aria-current")).toBe(
    null,
  );
  await act(async () =>
    host!.querySelector<HTMLButtonElement>('[data-testid="sidebar-team"]')!.click(),
  );
  expect(onOpen).toHaveBeenCalledWith("/app/team");
});
