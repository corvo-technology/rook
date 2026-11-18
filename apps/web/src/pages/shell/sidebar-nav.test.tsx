// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const missionsApi = vi.hoisted(() => ({ get: vi.fn(), seen: vi.fn(), showAll: vi.fn() }));
const approvals = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../lib/query", () => ({
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
  }),
}));
vi.mock("../../lib/use-pending-approvals", () => ({
  usePendingApprovals: () => ({ data: Array.from({ length: approvals.count }) }),
}));
vi.mock("../../lib/use-direct-people", () => ({ useDirectPeople: () => ({ data: [] }) }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@lingui/core/macro", () => ({ plural: () => "" }));

import { SidebarNavLive } from "./sidebar-team";

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  approvals.count = 0;
  missionsApi.get.mockReset();
  missionsApi.seen.mockReset().mockResolvedValue({ ok: true });
  missionsApi.showAll.mockReset().mockResolvedValue({ ok: true });
});

async function renderNav(
  props: { ticketBoardEnabled?: boolean; embedded?: boolean; path?: string } = {},
  onOpen = vi.fn(),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[props.path ?? "/app"]}>
          <SidebarNavLive
            ticketBoardEnabled={props.ticketBoardEnabled ?? true}
            embedded={props.embedded ?? false}
            onOpen={onOpen}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const labels = () =>
    [...container.querySelectorAll("nav button:not([data-testid=sidebar-quick-switch])")].map(
      (button) => button.textContent,
    );
  const more = async () => {
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="sidebar-more"]')!.click(),
    );
    return [...document.querySelectorAll('[data-slot="popover-content"] button')].map(
      (button) => button.textContent,
    );
  };
  return {
    container,
    labels,
    more,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("lists every place once, with the rest behind More", async () => {
  const { labels, more, cleanup } = await renderNav();
  expect(labels()).toEqual(["Home", "Approvals", "Tasks", "Routines", "Activity", "Team", "More"]);
  expect(await more()).toEqual(["Workflows", "Usage", "Artifacts", "Wiki", "Memory"]);
  await cleanup();
});

it("offers the platform area to its operators only, and opens its pricing", async () => {
  const other = await renderNav();
  expect(await other.more()).not.toContain("Platform");
  await other.cleanup();
  document.body.innerHTML = "";
  queryClient.setQueryData(["bootstrap"], { me: { partnerAdmin: true } });
  const onOpen = vi.fn();
  const operator = await renderNav({}, onOpen);
  expect(await operator.more()).toContain("Platform");
  const entry = [...document.querySelectorAll('[data-slot="popover-content"] button')].find(
    (button) => button.textContent === "Platform",
  ) as HTMLButtonElement;
  await act(async () => entry.click());
  expect(onOpen).toHaveBeenCalledWith("/app/platform/pricing");
  await operator.cleanup();
});

it("leaves Tasks out only where the board is off", async () => {
  const { labels, cleanup } = await renderNav({ ticketBoardEnabled: false });
  expect(labels()).not.toContain("Tasks");
  await cleanup();
});

it("lists Tasks even before a mission brings it, unless a partner hides it", async () => {
  queryClient.setQueryData(["bootstrap"], { me: { shortNav: true } });
  missionsApi.get.mockResolvedValue({ short: true, completed: [], has: [], seen: [] });
  const short = await renderNav();
  expect(short.labels()).toContain("Tasks");
  await short.cleanup();
  queryClient.setQueryData(["bootstrap"], { me: { partner: { name: "Acme", hide: ["board"] } } });
  const hidden = await renderNav();
  expect(hidden.labels()).not.toContain("Tasks");
  await hidden.cleanup();
});

it("gives each place an icon and opens More as a menu", async () => {
  const { container, cleanup } = await renderNav();
  for (const button of container.querySelectorAll("nav button:not([data-testid=sidebar-more])")) {
    if (button.getAttribute("data-testid") === "sidebar-quick-switch") continue;
    expect(button.querySelector("svg")).not.toBeNull();
  }
  expect(
    container.querySelector('[data-testid="sidebar-more"]')?.getAttribute("aria-haspopup"),
  ).toBe("menu");
  await cleanup();
});

it("opens the quick switcher from the field above the places", async () => {
  const onQuickSwitch = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SidebarNavLive
            ticketBoardEnabled
            embedded={false}
            onOpen={vi.fn()}
            onQuickSwitch={onQuickSwitch}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-testid="sidebar-quick-switch"]')!.click(),
  );
  expect(onQuickSwitch).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  container.remove();
});

it("opens Home on the home page, not on a chat", async () => {
  const onOpen = vi.fn();
  const { container, cleanup } = await renderNav({}, onOpen);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-testid="sidebar-home"]')!.click(),
  );
  expect(onOpen).toHaveBeenCalledWith("/app/home");
  await cleanup();
});

it("shows the approvals count only while something waits", async () => {
  approvals.count = 2;
  const { container, cleanup } = await renderNav();
  expect(container.querySelector('[data-testid="sidebar-approvals-count"]')?.textContent).toBe("2");
  await cleanup();
});

it("marks the open page, in the nav or behind More", async () => {
  const activity = await renderNav({ path: "/app/activity" });
  expect(
    activity.container
      .querySelector('[data-testid="sidebar-activity"]')
      ?.getAttribute("aria-current"),
  ).toBe("page");
  await activity.cleanup();
  const wiki = await renderNav({ path: "/app/wiki" });
  expect(
    wiki.container.querySelector('[data-testid="sidebar-more"]')?.getAttribute("aria-current"),
  ).toBe("page");
  await wiki.cleanup();
});

it("keeps account settings out of a partner's frame", async () => {
  const { more, cleanup } = await renderNav({ embedded: true });
  expect(await more()).toEqual(["Workflows", "Usage", "Artifacts", "Wiki"]);
  await cleanup();
});

it("leaves out what a partner hides from its customers", async () => {
  queryClient.setQueryData(["bootstrap"], {
    me: { partner: { name: "Acme", hide: ["routines", "usage"] } },
  });
  const { labels, more, cleanup } = await renderNav();
  expect(labels()).not.toContain("Routines");
  expect(await more()).toEqual(["Workflows", "Artifacts", "Wiki", "Memory"]);
  await cleanup();
});

it("starts short: only the places that are always there until a mission brings more", async () => {
  queryClient.setQueryData(["bootstrap"], { me: { shortNav: true } });
  missionsApi.get.mockResolvedValue({ short: true, completed: [], has: [], seen: [] });
  const { labels, cleanup } = await renderNav();
  expect(labels()).toEqual(["Home", "Approvals", "Tasks", "Activity"]);
  await cleanup();
});

it("marks a place a mission brought as new, and clears the mark when it is opened", async () => {
  queryClient.setQueryData(["bootstrap"], { me: { shortNav: true } });
  missionsApi.get.mockResolvedValue({ short: true, completed: ["routine"], has: [], seen: [] });
  const { container, cleanup } = await renderNav();
  const routines = container.querySelector<HTMLButtonElement>('[data-testid="sidebar-routines"]');
  expect(routines?.textContent).toContain("New");
  await act(async () => routines?.click());
  expect(missionsApi.seen.mock.calls[0]?.[0]).toEqual({ part: "routines" });
  await cleanup();
});
