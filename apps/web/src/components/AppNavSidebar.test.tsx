// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const footer = vi.hoisted(() => vi.fn());
const embedded = vi.hoisted(() => ({ value: false }));
vi.mock("../lib/embed", () => ({ isEmbedded: () => embedded.value }));
vi.mock("../lib/auth", () => ({
  authClient: { useSession: () => ({ data: { user: { name: "Ada" } } }) },
}));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({ bootstrap: { queryOptions: () => ({ queryKey: ["bootstrap"] }) } }),
}));
vi.mock("../pages/shell/shell-sidebar", () => ({
  ShellSidebarFooter: (props: { navLinks: unknown[] }) => {
    footer(props.navLinks);
    return null;
  },
}));
vi.mock("../pages/WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("./SidebarNav", () => ({ SidebarNav: () => <nav data-testid="nav-list" /> }));
vi.mock("./SubscriptionRings", () => ({ SubscriptionRailRings: () => null }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { AppNavSidebar } from "./AppNavSidebar";

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
  footer.mockReset();
  embedded.value = false;
});

async function renderSidebar() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppNavSidebar ticketBoardEnabled={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("shows the navigation list with the account at the bottom", async () => {
  queryClient.setQueryData(["bootstrap"], { me: { navLinks: [{ id: "docs", label: "Docs" }] } });
  const { container, cleanup } = await renderSidebar();
  expect(container.querySelector('[data-testid="nav-list"]')).not.toBeNull();
  expect(footer).toHaveBeenLastCalledWith([{ id: "docs", label: "Docs" }]);
  await cleanup();
});

it("leaves the account out of a partner's frame", async () => {
  embedded.value = true;
  const { container, cleanup } = await renderSidebar();
  expect(container.querySelector('[data-testid="nav-list"]')).not.toBeNull();
  expect(footer).not.toHaveBeenCalled();
  await cleanup();
});
