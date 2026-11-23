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
}));
vi.mock("../components/menu-picker", () => ({
  MenuPicker: ({
    label,
    choices,
    value,
    onChange,
  }: {
    label: string;
    choices: Array<{ key: string; label: string }>;
    value: string;
    onChange: (key: string) => void;
  }) =>
    createElement(
      "div",
      { role: "group", "aria-label": label },
      choices.map((choice) =>
        createElement(
          "button",
          {
            key: choice.key,
            type: "button",
            "aria-pressed": choice.key === value,
            onClick: () => onChange(choice.key),
          },
          choice.label,
        ),
      ),
    ),
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
const menu = () => host.querySelector<HTMLElement>('[role="group"]');
const choice = (label: string) =>
  [...host.querySelectorAll<HTMLElement>("button")].find((node) => node.textContent === label);
const chosen = () =>
  [...host.querySelectorAll<HTMLElement>("button")].find(
    (node) => node.getAttribute("aria-pressed") === "true",
  )?.textContent;

it("shows nothing while the curator cannot read the conversation", async () => {
  get.mockResolvedValue(state({ available: false, on: false }));
  await mount();
  expect(menu()).toBeNull();
});

it("shows the stored choice and sends on, off or null", async () => {
  get.mockResolvedValue(state());
  set.mockResolvedValue(undefined);
  await mount();
  expect(get).toHaveBeenCalledWith({ botId: "b1", groupId: undefined });
  expect(chosen()).toBe("Default");
  await act(async () => choice("Never")?.click());
  expect(set).toHaveBeenLastCalledWith({ botId: "b1", groupId: undefined }, false);
  expect(chosen()).toBe("Never");
  await act(async () => choice("Always")?.click());
  expect(set).toHaveBeenLastCalledWith({ botId: "b1", groupId: undefined }, true);
  await act(async () => choice("Default")?.click());
  expect(set).toHaveBeenLastCalledWith({ botId: "b1", groupId: undefined }, null);
});

it("goes back to the previous choice when saving fails", async () => {
  get.mockResolvedValue(state({ capture: true }));
  set.mockRejectedValue(new Error("offline"));
  await mount();
  await act(async () => choice("Never")?.click());
  await act(async () => void (await Promise.resolve()));
  expect(chosen()).toBe("Always");
});

it("is hidden from someone who does not own the conversation", async () => {
  get.mockResolvedValue(state({ canChange: false }));
  await mount();
  expect(menu()).toBeNull();
});
