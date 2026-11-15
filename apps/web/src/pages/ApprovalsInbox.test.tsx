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
import { SidebarApprovals } from "./shell/sidebar-team";

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

it("shows the sidebar entry with its count only while something waits", async () => {
  await mount(<SidebarApprovals count={3} onOpen={vi.fn()} />);
  expect(host!.querySelector('[data-testid="sidebar-approvals-count"]')?.textContent).toBe("3");
  await act(async () => createRoot(host!).render(<SidebarApprovals count={0} onOpen={vi.fn()} />));
  expect(host!.querySelector('[data-testid="sidebar-approvals"]')).toBeNull();
});
