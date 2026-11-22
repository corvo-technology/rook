// @vitest-environment jsdom
import type { Bot } from "@corvo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HomeComposer } from "./HomeComposer";
import { HomeHero } from "./HomeHero";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

async function mount(node: React.ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    async cleanup() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("asks the Chief and offers no agent to pick", async () => {
  const chief = { id: "bot-1", name: "Rook", color: "blue" } as Bot;
  const view = await mount(
    <HomeComposer
      target={chief}
      text=""
      onText={vi.fn()}
      sending={false}
      error={null}
      onSend={vi.fn()}
      inputRef={{ current: null }}
    />,
  );
  expect(view.host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
    "Ask Rook for something",
  );
  expect(view.host.querySelector('[aria-label="Agent"]')).toBeNull();
  await view.cleanup();
});

it("has no start page selector and shows the status line in the body font", async () => {
  const view = await mount(
    <HomeHero greeting="Hi" status={{ working: 0, waiting: 0, nextInMinutes: 47 }} />,
  );
  expect(view.host.querySelector('[data-testid="home-start-pick"]')).toBeNull();
  const status = view.host.querySelector('[data-testid="home-status"]');
  expect(status).not.toBeNull();
  expect(status?.className).not.toContain("font-mono");
  await view.cleanup();
});
