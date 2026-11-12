// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const takeInitialBootstrap = vi.hoisted(() => vi.fn());
const footer = vi.hoisted(() => vi.fn());
const footerBoard = vi.hoisted(() => vi.fn());
const embedded = vi.hoisted(() => ({ value: false }));
const missionsApi = vi.hoisted(() => ({ get: vi.fn(), seen: vi.fn(), showAll: vi.fn() }));
vi.mock("../lib/embed", () => ({ isEmbedded: () => embedded.value }));
vi.mock("../lib/bootstrap", () => ({ takeInitialBootstrap }));
vi.mock("../lib/auth", () => ({
  authClient: { useSession: () => ({ data: { user: { name: "Ada" } } }) },
}));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    bootstrap: { queryOptions: () => ({ queryKey: ["bootstrap"] }) },
    missions: {
      get: {
        queryKey: () => ["missions"],
        queryOptions: () => ({ queryKey: ["missions"], queryFn: missionsApi.get }),
      },
      seen: { mutationOptions: () => ({ mutationFn: missionsApi.seen }) },
      showAll: { mutationOptions: () => ({ mutationFn: missionsApi.showAll }) },
    },
    usage: {
      subscriptions: {
        queryOptions: () => ({ queryKey: ["subscriptions"], queryFn: async () => [] }),
      },
    },
  }),
}));
vi.mock("../pages/shell/shell-sidebar", () => ({
  ShellSidebarFooter: (props: { navLinks: unknown[]; ticketBoardEnabled: boolean }) => {
    footer(props.navLinks);
    footerBoard(props.ticketBoardEnabled);
    return null;
  },
}));
vi.mock("../pages/WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("./IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactElement }) => children,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { AppRail } from "./AppRail";

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  takeInitialBootstrap.mockReset();
  missionsApi.get.mockReset();
  missionsApi.seen.mockReset().mockResolvedValue({ ok: true });
  missionsApi.showAll.mockReset().mockResolvedValue({ ok: true });
  footer.mockReset();
  footerBoard.mockReset();
  embedded.value = false;
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

async function openMore(container: HTMLElement) {
  const more = container.querySelector('nav button[aria-label="More"]') as HTMLButtonElement;
  await act(async () => more.click());
  return [
    ...document.querySelectorAll('[role="dialog"] button, [data-slot="popover-content"] button'),
  ]
    .map((button) => button.textContent)
    .filter(Boolean);
}

async function renderRail(ticketBoardEnabled = false, path = "/app") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <AppRail ticketBoardEnabled={ticketBoardEnabled} />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  // The missions answer arrives after the first render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("never takes the first bootstrap, which the agents screen needs for itself", async () => {
  const { cleanup } = await renderRail();
  expect(takeInitialBootstrap).not.toHaveBeenCalled();
  await cleanup();
});

it("shows the links a screen beside it has already loaded", async () => {
  queryClient.setQueryData(["bootstrap"], { me: { navLinks: [{ id: "docs", label: "Docs" }] } });
  const { cleanup } = await renderRail();
  expect(footer).toHaveBeenLastCalledWith([{ id: "docs", label: "Docs" }]);
  await cleanup();
});

it("keeps four areas in sight and the rest behind three dots", async () => {
  const { container, cleanup } = await renderRail();
  const buttons = [...container.querySelectorAll("nav button")];
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Agents",
    "Team",
    "Routines",
    "Workflows",
    "More",
    "Store",
  ]);
  expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
  expect(buttons[4]?.getAttribute("aria-current")).toBeNull();
  await cleanup();
});

it("puts the board right under Agents when the board is on, and nowhere when it is off", async () => {
  const on = await renderRail(true);
  const labels = [...on.container.querySelectorAll("nav button")].map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(labels.slice(0, 3)).toEqual(["Agents", "Tasks", "Team"]);
  const board = on.container.querySelector<HTMLButtonElement>('nav button[aria-label="Tasks"]');
  await act(async () => board?.click());
  expect(on.container.querySelector('[data-testid="where"]')?.textContent).toBe("/app/board");
  expect(board?.getAttribute("aria-current")).toBe("page");
  await on.cleanup();
  const off = await renderRail(false);
  expect(off.container.querySelector('nav button[aria-label="Tasks"]')).toBeNull();
  await off.cleanup();
});

it("leaves the board out of the account menu the rail carries, which would repeat it", async () => {
  const { cleanup } = await renderRail(true);
  expect(footerBoard).toHaveBeenLastCalledWith(false);
  await cleanup();
});

it("lists Usage, Artifacts, Wiki, Approvals and Memory behind the dots, and goes where one points", async () => {
  const { container, cleanup } = await renderRail();
  expect(await openMore(container)).toEqual(["Usage", "Artifacts", "Wiki", "Approvals", "Memory"]);
  const wiki = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Wiki",
  ) as HTMLButtonElement;
  await act(async () => wiki.click());
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/app/wiki");
  await openMore(container);
  const approvals = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Approvals",
  ) as HTMLButtonElement;
  await act(async () => approvals.click());
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe(
    "/app?settings=confirmations",
  );
  await cleanup();
});

it("keeps only the places that are not account settings inside a partner's frame", async () => {
  embedded.value = true;
  const { container, cleanup } = await renderRail();
  expect(await openMore(container)).toEqual(["Usage", "Artifacts", "Wiki"]);
  expect(footer).not.toHaveBeenCalled();
  await cleanup();
});

it("leaves out what a partner hides from its customers, never the agents", async () => {
  queryClient.setQueryData(["bootstrap"], {
    me: { partner: { name: "Acme", hide: ["usage", "store"] } },
  });
  const { container, cleanup } = await renderRail();
  const buttons = [...container.querySelectorAll("nav button")];
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Agents",
    "Team",
    "Routines",
    "Workflows",
    "More",
  ]);
  expect(await openMore(container)).toEqual(["Artifacts", "Wiki", "Approvals", "Memory"]);
  await cleanup();
});

function shortAccount(view: unknown, hide: string[] = []) {
  queryClient.setQueryData(["bootstrap"], {
    me: { shortNav: true, partner: hide.length ? { name: "Acme", hide } : null },
  });
  missionsApi.get.mockResolvedValue(view);
}

const labelsOf = (container: HTMLElement) =>
  [...container.querySelectorAll("nav button")].map((button) => button.getAttribute("aria-label"));

it("starts short: only Agents and the Store until a mission brings more", async () => {
  shortAccount({ short: true, completed: [], has: [], seen: [] });
  const { container, cleanup } = await renderRail(true);
  expect(labelsOf(container)).toEqual(["Agents", "Store"]);
  await cleanup();
});

it("brings Team and Workflows with the second agent, and the board only where it is on", async () => {
  shortAccount({ short: true, completed: ["second"], has: [], seen: ["team", "workflows"] });
  const { container, cleanup } = await renderRail(false);
  expect(labelsOf(container)).toEqual(["Agents", "Team", "Workflows", "Store"]);
  await cleanup();
});

it("marks a brought part new, and clears the mark when it is opened", async () => {
  shortAccount({ short: true, completed: ["routine"], has: [], seen: [] });
  missionsApi.seen.mockImplementation(async () => {
    missionsApi.get.mockResolvedValue({
      short: true,
      completed: ["routine"],
      has: [],
      seen: ["routines"],
    });
    return { ok: true };
  });
  const { container, cleanup } = await renderRail();
  const routines = container.querySelector<HTMLButtonElement>('nav button[aria-label="Routines"]');
  expect(routines?.textContent).toContain("New");
  await act(async () => routines?.click());
  expect(missionsApi.seen.mock.calls[0]?.[0]).toEqual({ part: "routines" });
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/app/routines");
  expect(routines?.textContent).not.toContain("New");
  await cleanup();
});

it("shows the page the person is on even before its mission is done", async () => {
  shortAccount({ short: true, completed: [], has: [], seen: [] });
  const { container, cleanup } = await renderRail(false, "/app/routines");
  const routines = container.querySelector('nav button[aria-label="Routines"]');
  expect(routines?.getAttribute("aria-current")).toBe("page");
  expect(routines?.textContent).not.toContain("New");
  await cleanup();
});

it("never brings back what a partner hides", async () => {
  shortAccount({ short: true, completed: ["routine"], has: [], seen: [] }, ["routines"]);
  const { container, cleanup } = await renderRail();
  expect(labelsOf(container)).not.toContain("Routines");
  await cleanup();
});

it("keeps only the ungated items while the missions are loading", async () => {
  queryClient.setQueryData(["bootstrap"], { me: { shortNav: true } });
  missionsApi.get.mockReturnValue(new Promise(() => {}));
  const { container, cleanup } = await renderRail();
  expect(labelsOf(container)).toEqual(["Agents", "Store"]);
  await cleanup();
});

it("lists the places a mission brought behind the dots and marks them", async () => {
  shortAccount({ short: true, completed: ["talk"], has: [], seen: [] });
  const { container, cleanup } = await renderRail();
  expect(await openMore(container)).toEqual(["UsageNew", "ArtifactsNew"]);
  await cleanup();
});

it("draws Agents with the rook glyph in ink", async () => {
  const { container, cleanup } = await renderRail();
  const agents = container.querySelector('nav button[aria-label="Agents"]');
  expect(agents?.querySelector(".corvo-rook-glyph")?.getAttribute("data-state")).toBe("idle");
  expect(container.querySelector('nav button[aria-label="Team"] .corvo-rook-glyph')).toBeNull();
  await cleanup();
});
