// @vitest-environment jsdom
import type { GroupMember } from "@corvo/contracts";
import type { ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactElement }) => children,
}));

import { ChannelHeader } from "./channel-header";

const member = (id: string): GroupMember => ({ botId: id, name: id, color: "#3B82F6" });

async function render(props: Partial<Parameters<typeof ChannelHeader>[0]> = {}) {
  const handlers = {
    onOpenNavigation: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenSquad: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () =>
    root.render(
      <ChannelHeader
        name="checkout"
        purpose="Online store, payments and cart"
        members={[member("a"), member("b"), member("c"), member("d")]}
        {...handlers}
        {...props}
      />,
    ),
  );
  return { host, root, handlers };
}

it("shows the channel as a name behind a hash, with what it is for", async () => {
  const { host, root } = await render();
  expect(host.textContent).toContain("#");
  expect(host.textContent).toContain("checkout");
  expect(host.textContent).toContain("Online store, payments and cart");
  await act(async () => root.unmount());
});

it("counts the agents and the people in a members button that toggles the panel", async () => {
  const onOpenMembers = vi.fn();
  const { host, root } = await render({ onOpenMembers, peopleCount: 3 });
  const button = host.querySelector<HTMLButtonElement>('[data-testid="channel-members-toggle"]')!;
  expect(button.textContent).toBe("7 members");
  await act(async () => button.click());
  expect(onOpenMembers).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("has no purpose line when the channel has none", async () => {
  const { host, root } = await render({ purpose: null });
  expect(host.textContent).not.toContain("Online store");
  await act(async () => root.unmount());
});

it("opens the channel's settings from its name, and the squad from its own button", async () => {
  const { host, root, handlers } = await render();
  const press = async (selector: string) =>
    act(async () => (host.querySelector(selector) as HTMLButtonElement).click());
  await press('[data-testid="bot-settings-trigger"]');
  expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
  await press('button[aria-label="Squad"]');
  expect(handlers.onOpenSquad).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("says who is working beside the search", async () => {
  const members: GroupMember[] = [
    { ...member("a") },
    { ...member("b"), status: "idle" },
    { ...member("c"), status: "running" },
    { ...member("d"), status: "queued" },
  ];
  const { host, root } = await render({ members });
  const status = host.querySelector('[data-testid="channel-working"]');
  expect(status?.textContent).toBe("c +1 · Working…");
  await act(async () => root.unmount());
});

it("shows nothing about work once no one is working", async () => {
  const { host, root } = await render({
    members: [member("a"), { ...member("b"), status: "idle" }],
  });
  expect(host.querySelector('[data-testid="channel-working"]')).toBeNull();
  await act(async () => root.unmount());
});
