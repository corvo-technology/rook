// @vitest-environment jsdom

import type { MissionsView } from "@corvo/contracts";
import { MISSION_IDS } from "@corvo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  view: null as unknown,
  listed: true,
  showAll: vi.fn(),
  seen: vi.fn(),
}));
vi.mock("../lib/use-missions", () => ({
  useMissions: () => ({
    view: state.view,
    listed: state.listed,
    showAll: state.showAll,
    showingAll: false,
    open: state.seen,
  }),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));

import { MissionList } from "./MissionList";

const view = (over: Partial<MissionsView> = {}): MissionsView => ({
  short: true,
  completed: [],
  has: [],
  seen: [],
  ...over,
});

beforeEach(() => {
  state.view = view();
  state.listed = true;
  state.showAll.mockReset();
  state.seen.mockReset();
});

async function render() {
  const navigate = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<MissionList navigate={navigate} />));
  return { container, navigate, cleanup: () => act(async () => root.unmount()) };
}

it("renders nothing when the list is not shown", async () => {
  for (const [v, listed] of [
    [null, false],
    [view({ short: false }), false],
    [view({ completed: [...MISSION_IDS] }), false],
  ] as const) {
    state.view = v;
    state.listed = listed;
    const { container, cleanup } = await render();
    expect(container.innerHTML).toBe("");
    await cleanup();
  }
});

it("lists the six missions in order", async () => {
  const { container, cleanup } = await render();
  expect(container.querySelector("ol")?.getAttribute("aria-label")).toBe("Missions");
  expect(container.querySelector("ol")?.getAttribute("data-coach")).toBe("missions");
  expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
    "Talk to your agent",
    "Answer a request",
    "Connect an app",
    "Add a second agent",
    "Schedule a routine",
    "Keep a memory",
  ]);
  await cleanup();
});

it("exposes a completed mission as checked and not as a button", async () => {
  state.view = view({ completed: ["talk"] });
  const { container, cleanup } = await render();
  const first = container.querySelector("li");
  expect(first?.querySelector("button")).toBeNull();
  expect(first?.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(true);
  await cleanup();
});

it("only navigates when a mission is clicked", async () => {
  const { container, navigate, cleanup } = await render();
  const routine = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Schedule a routine",
  );
  await act(async () => routine?.click());
  expect(navigate).toHaveBeenCalledWith("/app/routines");
  expect(state.seen).not.toHaveBeenCalled();
  expect(state.showAll).not.toHaveBeenCalled();
  const decide = [...container.querySelectorAll("li")][1];
  expect(decide?.querySelector("button")).toBeNull();
  await cleanup();
});

it("ends short mode from the one button", async () => {
  const { container, cleanup } = await render();
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Show everything",
  );
  await act(async () => button?.click());
  expect(state.showAll).toHaveBeenCalledTimes(1);
  await cleanup();
});
