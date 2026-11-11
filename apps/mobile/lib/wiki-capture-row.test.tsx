// @vitest-environment jsdom

import type { WikiCaptureState } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("./i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("./wiki", () => ({ getWikiCapture: get, setWikiCapture: set }));
vi.mock("../components/settings-group", () => ({
  SettingsGroup: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  SettingsSwitch: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
  }) =>
    createElement("button", {
      type: "button",
      role: "switch",
      "aria-label": label,
      "aria-checked": value,
      disabled,
      onClick: () => onChange(!value),
    }),
}));

import { WikiCaptureRow } from "../components/wiki-capture-row";

const state = (patch: Partial<WikiCaptureState> = {}): WikiCaptureState => ({
  available: true,
  capture: null,
  on: true,
  canChange: true,
  ...patch,
});

let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.replaceChildren(host);
  get.mockReset();
  set.mockReset();
});

async function mount() {
  await act(async () => {
    createRoot(host).render(createElement(WikiCaptureRow, { target: { botId: "b1" } }));
  });
  await act(async () => void (await Promise.resolve()));
}
const toggle = () => host.querySelector<HTMLElement>('[role="switch"]');

it("shows nothing while the curator cannot read the conversation", async () => {
  get.mockResolvedValue(state({ available: false, on: false }));
  await mount();
  expect(toggle()).toBeNull();
});

it("shows the effective value and sends an explicit boolean", async () => {
  get.mockResolvedValue(state());
  set.mockResolvedValue(undefined);
  await mount();
  expect(get).toHaveBeenCalledWith({ botId: "b1", groupId: undefined });
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle()?.click());
  expect(set).toHaveBeenCalledWith({ botId: "b1", groupId: undefined }, false);
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
});

it("goes back to the previous value when saving fails", async () => {
  get.mockResolvedValue(state());
  set.mockRejectedValue(new Error("offline"));
  await mount();
  await act(async () => toggle()?.click());
  await act(async () => void (await Promise.resolve()));
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
});

it("is disabled for someone who does not own the conversation", async () => {
  get.mockResolvedValue(state({ canChange: false }));
  await mount();
  expect(toggle()?.hasAttribute("disabled")).toBe(true);
});
