// @vitest-environment jsdom
import type { ThreadMessage } from "@corvo/contracts";
import type { ReactElement, ReactNode } from "react";
import { act, cloneElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/MessageHoverMetadata", () => ({
  MessageHoverMetadata: ({ children }: { children: ReactElement }) => cloneElement(children),
}));

import { MessageHoverActions } from "./message-hover-actions";

const message = {
  id: "m1",
  threadId: "t1",
  role: "bot",
  blocks: [{ kind: "text", text: "We chose Alpha Builders." }],
} as unknown as ThreadMessage;

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show(onKeepInWiki?: (message: ThreadMessage) => void, shown = message) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MessageHoverActions
        message={shown}
        side="start"
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn(async () => undefined)}
        onKeepInWiki={onKeepInWiki}
      />,
    );
  });
  return container;
}
const items = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);

describe("keeping a message in the wiki from its menu", () => {
  it("offers it for a message with words in it, and hands the message over when chosen", async () => {
    const keep = vi.fn();
    const container = await show(keep);
    expect(items(container)).toContain("Keep in the wiki");
    await act(async () =>
      (
        [...container.querySelectorAll('[role="menuitem"]')].find(
          (item) => item.textContent === "Keep in the wiki",
        ) as HTMLElement
      ).click(),
    );
    expect(keep).toHaveBeenCalledWith(message);
  });

  it("is not there where the conversation has no way to keep a message", async () => {
    expect(items(await show(undefined))).not.toContain("Keep in the wiki");
  });

  it("is not there for a message with nothing to keep", async () => {
    const empty = { ...message, blocks: [] } as unknown as ThreadMessage;
    expect(items(await show(vi.fn(), empty))).not.toContain("Keep in the wiki");
  });
});

describe("opening a message's thread from its actions", () => {
  async function showWith(props: {
    onReply?: (message: ThreadMessage) => void;
    onReplyInThread?: (message: ThreadMessage) => void;
  }) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MessageHoverActions
          message={message}
          side="start"
          onMarkUnread={vi.fn()}
          onReact={vi.fn(async () => undefined)}
          {...props}
        />,
      );
    });
    return container;
  }

  it("opens the thread of the message it sits on", async () => {
    const open = vi.fn();
    const container = await showWith({ onReply: vi.fn(), onReplyInThread: open });
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reply in thread"]',
    );
    await act(async () => button?.click());
    expect(open).toHaveBeenCalledWith(message);
  });

  it("offers neither reply where the channel gives it no way to", async () => {
    const container = await showWith({});
    expect(container.querySelector('button[aria-label="Reply in thread"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Reply"]')).toBeNull();
  });
});
