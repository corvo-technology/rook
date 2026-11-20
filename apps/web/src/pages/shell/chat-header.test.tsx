// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  BotAvatar: () => <span />,
  GroupAvatar: () => <span />,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));
vi.mock("../../components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./channel-find", () => ({ ChannelFind: () => null, pinSignature: () => "" }));
vi.mock("./chat-model-switcher", () => ({ ChatModelSwitcher: () => null }));
vi.mock("./context-meter", () => ({ ContextMeter: () => null }));

import { ChatHeader } from "./chat-header";

let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

async function render(over: Partial<ComponentProps<typeof ChatHeader>> = {}) {
  const onOpenSquad = vi.fn();
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ChatHeader
        inGroup
        active={undefined}
        activeGroup={{ id: "group-1", name: "Product", members: [] } as never}
        activeSnapshot={null}
        phoneCallsEnabled={false}
        inCall={false}
        running={false}
        computerPanelOpen={false}
        onOpenNavigation={vi.fn()}
        onOpenChatSettings={vi.fn()}
        onCall={vi.fn()}
        onToggleComputer={vi.fn()}
        onChangeModel={vi.fn()}
        onOpenSquad={onOpenSquad}
        onJumpToMessage={vi.fn()}
        memberName={() => undefined}
        {...over}
      />,
    ),
  );
  return { onOpenSquad, unmount: () => act(async () => root.unmount()) };
}

it("opens the squad screen from a group chat", async () => {
  const { onOpenSquad, unmount } = await render();
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Squad"]');
  expect(button).not.toBeNull();
  await act(async () => button?.click());
  expect(onOpenSquad).toHaveBeenCalledTimes(1);
  await unmount();
});

it("has no squad button in a chat with a single bot", async () => {
  const { unmount } = await render({
    inGroup: false,
    activeGroup: undefined,
    active: { id: "bot-1", name: "Chief", color: "blue", status: "idle" } as never,
  });
  expect(container.querySelector('button[aria-label="Squad"]')).toBeNull();
  await unmount();
});

it("is a row of its own with the name and role on the left, never floating over the messages", async () => {
  const { unmount } = await render({
    inGroup: false,
    activeGroup: undefined,
    phoneCallsEnabled: true,
    active: {
      id: "bot-1",
      name: "Chief",
      title: "Leads the team",
      color: "blue",
      status: "idle",
    } as never,
  });
  const header = container.firstElementChild as HTMLElement;
  expect(header.className).not.toContain("absolute");
  expect(header.className).toContain("border-b");
  const trigger = header.querySelector('[data-testid="bot-settings-trigger"]');
  expect(trigger?.textContent).toContain("Chief");
  expect(trigger?.textContent).toContain("Leads the team");
  expect(header.querySelector('[data-testid="call-button"]')).not.toBeNull();
  expect(header.querySelector('button[aria-label="Agent computer"]')).not.toBeNull();
  await unmount();
});

it("shows no working ring around the agent while it works", async () => {
  const { unmount } = await render({
    inGroup: false,
    activeGroup: undefined,
    active: { id: "bot-1", name: "Chief", color: "blue", status: "running" } as never,
  });
  expect(container.querySelector(".corvo-bot-avatar-ring")).toBeNull();
  await unmount();
});
