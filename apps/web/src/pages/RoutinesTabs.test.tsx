// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const shows = vi.hoisted(() => vi.fn());
vi.mock("../lib/use-missions", () => ({ useMissions: () => ({ shows }) }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { RoutinesTabs } from "./RoutinesTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Path() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

async function mount(path: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <RoutinesTabs>
          <Path />
        </RoutinesTabs>
      </MemoryRouter>,
    ),
  );
  return {
    container,
    tabs: () => [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
    path: () => container.querySelector('[data-testid="path"]')?.textContent,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => shows.mockReset());

it("offers Calendar and Flows once the flows are brought", async () => {
  shows.mockReturnValue(true);
  const view = await mount("/app/routines");
  expect(view.tabs()).toEqual(["Calendar", "Flows"]);
  const flows = view.container.querySelectorAll<HTMLElement>('[role="tab"]')[1] as HTMLElement;
  await act(async () => flows.click());
  expect(view.path()).toBe("/app/workflows");
  await view.cleanup();
});

it("shows no tabs while the flows are still hidden", async () => {
  shows.mockReturnValue(false);
  const view = await mount("/app/routines");
  expect(view.tabs()).toEqual([]);
  expect(view.path()).toBe("/app/routines");
  await view.cleanup();
});

it("keeps the tabs on the flows address so a direct link can go back", async () => {
  shows.mockReturnValue(false);
  const view = await mount("/app/workflows");
  expect(view.tabs()).toEqual(["Calendar", "Flows"]);
  await view.cleanup();
});
