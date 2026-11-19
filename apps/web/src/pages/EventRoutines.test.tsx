// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const events = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const rpcClient = vi.hoisted(() => ({ routines: { events, update } }));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray) => parts.join(""),
    i18n: { locale: "en" },
  }),
}));
vi.mock("@corvo/ui-web", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...rest
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  } & ComponentProps<"button">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    />
  ),
}));

import { EventRoutines } from "./EventRoutines";

const routine = (id: string, type: string, active: boolean, last: string | null = null) => ({
  id,
  botId: "b1",
  name: `Routine ${id}`,
  active,
  on: { type },
  lastTriggeredAt: last,
});

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  events.mockReset();
  update.mockReset();
});

async function renderIt() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <EventRoutines />
      </QueryClientProvider>,
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("shows nothing when no event starts a routine", async () => {
  events.mockResolvedValue([]);
  const view = await renderIt();
  expect(view.container.querySelector('[data-testid="event-routines"]')).toBeNull();
  await view.cleanup();
});

it("words each routine as the moment it waits for, with when it last started", async () => {
  events.mockResolvedValue([
    routine("1", "appointment.no_show", true, "2026-12-01T10:00:00.000Z"),
    routine("2", "customer.inactive", false),
  ]);
  const view = await renderIt();
  const text = view.container.textContent ?? "";
  expect(text).toContain("When a customer doesn't show up…");
  expect(text).toContain("When a customer stops coming…");
  expect(text).toContain("Routine 1 · ");
  expect(text).not.toContain("Routine 2 · ");
  await view.cleanup();
});

it("switches a routine off and on through the routine's own update", async () => {
  events.mockResolvedValue([routine("1", "appointment.no_show", true)]);
  update.mockResolvedValue({});
  const view = await renderIt();
  const toggle = view.container.querySelector<HTMLElement>('[aria-label="Routine 1"]');
  await act(async () => toggle?.click());
  expect(update).toHaveBeenCalledWith({ routineId: "1", active: false });
  await view.cleanup();
});

it("says so when the switch could not be changed", async () => {
  events.mockResolvedValue([routine("1", "appointment.no_show", true)]);
  update.mockRejectedValue(new Error("nope"));
  const view = await renderIt();
  await act(async () => view.container.querySelector<HTMLElement>('[role="switch"]')?.click());
  expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  await view.cleanup();
});
