// @vitest-environment jsdom
import type { Bot, Group } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), ""),
  }),
}));
vi.mock("@corvo/ui-web", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ContextMenuContent: Box,
    ContextMenuSub: Box,
    ContextMenuSubTrigger: Box,
    ContextMenuSubContent: Box,
    ContextMenuSeparator: () => <hr />,
    ContextMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" role="menuitem" onClick={onClick}>
        {children}
      </button>
    ),
  };
});
vi.mock("../../components/ErrorBoundary", async () => {
  const { BotContextMenu } = await import("../BotContextMenu");
  return { lazyOverlay: () => BotContextMenu };
});

import { ChatContextMenu } from "./chat-context-menu";

const bot = { id: "b1", name: "Ada", pinned: false, sectionId: null, unread: false } as Bot;
const channel = { id: "g1", threadId: "t1", name: "Ops", pinned: false } as Group;

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show(chat: { bot?: Bot; group?: Group }, set = vi.fn(async () => ({ ok: true }))) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const rpc = {
    notifications: { mutes: async () => [] },
    wiki: { capture: { set } },
  };
  await act(async () => {
    root!.render(
      <ChatContextMenu
        rpc={rpc as any}
        bot={chat.bot}
        group={chat.group}
        sections={[]}
        spaceId="s1"
        onClose={vi.fn()}
        refreshBots={async () => undefined}
        read={{ markBotRead: vi.fn(), markBotUnread: vi.fn(), toggleGroupUnread: vi.fn() }}
        dialogs={{} as any}
        openChatSettings={vi.fn()}
        navigate={vi.fn()}
      />,
    );
  });
  return container;
}
// The wiki items come after the mute ones, which also say "Always".
const item = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .filter((node) => node.textContent === label)
    .pop();

describe("the wiki switch in a chat's menu", () => {
  it("marks the stored value and sets a bot chat's switch", async () => {
    const set = vi.fn(async () => ({ ok: true }));
    const container = await show({ bot: { ...bot, wikiCapture: true } }, set);
    expect(item(container, "Always")?.querySelector("svg")).not.toBeNull();
    expect(item(container, "Never")?.querySelector("svg")).toBeNull();
    await act(async () => item(container, "Never")?.click());
    expect(set).toHaveBeenCalledWith({ botId: "b1", capture: false });
  });

  it("follows the default for a channel until set, and clears back to it", async () => {
    const set = vi.fn(async () => ({ ok: true }));
    const container = await show({ group: { ...channel, wikiCapture: null } }, set);
    expect(item(container, "Default")?.querySelector("svg")).not.toBeNull();
    await act(async () => item(container, "Always")?.click());
    expect(set).toHaveBeenLastCalledWith({ groupId: "g1", capture: true });
    await act(async () => item(container, "Default")?.click());
    expect(set).toHaveBeenLastCalledWith({ groupId: "g1", capture: null });
  });
});
