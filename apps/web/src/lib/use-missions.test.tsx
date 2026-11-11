// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), seen: vi.fn(), showAll: vi.fn() }));
vi.mock("./query", () => ({
  useSpaceQueries: () => ({
    bootstrap: {
      queryKey: () => ["bootstrap"],
      queryOptions: () => ({ queryKey: ["bootstrap"] }),
    },
    missions: {
      get: {
        queryKey: () => ["missions"],
        queryOptions: () => ({ queryKey: ["missions"], queryFn: api.get }),
      },
      seen: { mutationOptions: () => ({ mutationFn: api.seen }) },
      showAll: { mutationOptions: () => ({ mutationFn: api.showAll }) },
    },
  }),
}));

import { useMissions } from "./use-missions";

let queryClient: QueryClient;
let current: ReturnType<typeof useMissions>;
function Probe() {
  current = useMissions();
  return null;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockReset();
  api.seen.mockReset().mockResolvedValue({ ok: true });
  api.showAll.mockReset().mockResolvedValue({ ok: true });
});

async function mount(me: Record<string, unknown>) {
  queryClient.setQueryData(["bootstrap"], { me });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app"]}>
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return () => act(async () => root.unmount());
}

it("shows everything and fetches nothing without shortNav", async () => {
  const unmount = await mount({});
  expect(api.get).not.toHaveBeenCalled();
  expect(current.shows("routines")).toBe(true);
  expect(current.isNew("routines")).toBe(false);
  await unmount();
});

it("hides gated parts while the missions are pending", async () => {
  api.get.mockReturnValue(new Promise(() => {}));
  const unmount = await mount({ shortNav: true });
  expect(current.ready).toBe(false);
  expect(current.shows("usage")).toBe(false);
  await unmount();
});

it("shows what a mission brought, marks it new, and clears the mark once opened", async () => {
  api.get.mockResolvedValue({ short: true, completed: ["talk"], has: [], seen: [] });
  const unmount = await mount({ shortNav: true });
  expect(current.shows("usage")).toBe(true);
  expect(current.isNew("usage")).toBe(true);
  expect(current.shows("routines")).toBe(false);
  await act(async () => current.open("usage"));
  expect(api.seen).toHaveBeenCalledTimes(1);
  expect(api.seen.mock.calls[0]?.[0]).toEqual({ part: "usage" });
  expect(current.isNew("usage")).toBe(false);
  await act(async () => current.open("routines"));
  expect(api.seen).toHaveBeenCalledTimes(1);
  await unmount();
});

it("ends short mode with one call", async () => {
  api.get.mockResolvedValue({ short: true, completed: [], has: [], seen: [] });
  const unmount = await mount({ shortNav: true });
  await act(async () => current.showAll());
  expect(api.showAll).toHaveBeenCalledTimes(1);
  await unmount();
});
