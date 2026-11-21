// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceSwitcher } from "./space-switcher";

// The switcher's copy is not under test.
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: string }) => children,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const spaces = [
  { id: "space-a", name: "Personal", bots: [{ id: "bot-a" }] },
  { id: "space-b", name: "Work", bots: [{ id: "bot-b", unread: true }] },
  { id: "space-c", name: "Empty", bots: [] },
];

async function open(props: Partial<Parameters<typeof SpaceSwitcher>[0]> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <SpaceSwitcher
        spaces={spaces}
        currentSpaceId="space-a"
        onSelect={onSelect}
        onCreate={onCreate}
        {...props}
      />,
    ),
  );
  await act(async () => host.querySelector<HTMLElement>('[data-testid="space-switcher"]')?.click());
  return { host, root, onSelect, onCreate };
}

it("opens another space on its first chat, or on setup while it has no bots", async () => {
  const { root, onSelect } = await open();
  await act(async () =>
    document.querySelector<HTMLElement>('[data-testid="space-switcher-item-space-b"]')?.click(),
  );
  expect(onSelect).toHaveBeenCalledWith("space-b", "/app/bot-b");
  await act(async () => root.unmount());
});

it("does nothing when the current space is picked again", async () => {
  const { root, onSelect } = await open();
  await act(async () =>
    document.querySelector<HTMLElement>('[data-testid="space-switcher-item-space-a"]')?.click(),
  );
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("starts a new space from the menu", async () => {
  const { root, onCreate } = await open();
  await act(async () =>
    document.querySelector<HTMLElement>('[data-testid="space-switcher-new"]')?.click(),
  );
  expect(onCreate).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it("marks the trigger when another space has an unread chat", async () => {
  const { host, root } = await open();
  expect(host.querySelector('[data-testid="space-switcher-unread"]')).not.toBeNull();
  await act(async () => root.unmount());
});

it("marks each space with its own color, picture or initial", async () => {
  const picture = "data:image/webp;base64,UklGRg==";
  const { host, root } = await open({
    spaces: [
      { id: "space-a", name: "Personal", logo: "#B45309", bots: [{ id: "bot-a" }] },
      { id: "space-b", name: "Work", logo: picture, bots: [] },
      { id: "space-c", name: "Empty", bots: [] },
    ],
  });
  const trigger = host.querySelector('[data-testid="space-switcher"]') as HTMLElement;
  expect(
    (trigger.querySelector('[data-testid="space-avatar"]') as HTMLElement).style.backgroundColor,
  ).toBe("rgb(180, 83, 9)");
  const item = (id: string) =>
    document.querySelector(
      `[data-testid="space-switcher-item-${id}"] [data-testid="space-avatar"]`,
    );
  expect(item("space-b")?.querySelector("img")?.getAttribute("src")).toBe(picture);
  expect(item("space-c")?.textContent).toBe("E");
  await act(async () => root.unmount());
});
