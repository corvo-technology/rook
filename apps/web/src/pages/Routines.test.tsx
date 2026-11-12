// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const calendar = vi.hoisted(() => vi.fn());
const testRun = vi.hoisted(() => vi.fn());
const rpcClient = vi.hoisted(() => ({ routines: { calendar, testRun }, bootstrap: vi.fn() }));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/bootstrap", () => ({
  takeInitialBootstrap: vi
    .fn()
    .mockResolvedValue({ bots: [{ id: "b1", name: "Chief", color: null, status: "idle" }] }),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
    Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
      (value === 1 ? one : other).replace("#", String(value)),
  };
});
vi.mock("@corvo/ui-web", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BotAvatar: () => <span />,
    botAccent: () => "#3b82f6",
    EmptyState: ({
      piece,
      title,
      "data-testid": testId,
    }: {
      piece: string;
      title: string;
      "data-testid": string;
    }) => (
      <div data-testid={testId}>
        <i data-piece={piece} />
        {title}
      </div>
    ),
    Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
    Button: (props: ComponentProps<"button">) => <button {...props} />,
    ToggleGroup: Container,
    ToggleGroupItem: Container,
  };
});
vi.mock("./RoutineCard", () => ({
  RoutineCard: ({ item, onOpenAgent }: { item: { name: string }; onOpenAgent: () => void }) => (
    <button type="button" data-testid="card" onClick={onOpenAgent}>
      {item.name}
    </button>
  ),
}));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("./NewRoutinePanel", () => ({
  NewRoutinePanel: () => <div data-testid="new-routine" />,
}));

import { RoutinesPage } from "./Routines";

const at = (hours: number, day = new Date()) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours).toISOString();

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60_000);

function occurrence(name: string, state: string, hours: number, day = new Date()) {
  return {
    routineId: name,
    name,
    botId: "b1",
    botName: "Chief",
    at: at(hours, day),
    state,
    runId: null,
  };
}

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  calendar.mockReset();
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app/routines"]}>
          <Where />
          <Routes>
            <Route path="/app/routines" element={<RoutinesPage />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
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

it("shows what ran, what failed and what is due, each under its day", async () => {
  calendar.mockResolvedValue({
    occurrences: [
      occurrence("Morning summary", "done", 1),
      occurrence("Weekly report", "failed", 2),
      occurrence("Evening check", "upcoming", 23),
    ],
    truncated: false,
  });
  const { container, cleanup } = await renderPage();
  const text = container.textContent ?? "";
  expect(text).toContain("Morning summary");
  expect(text).toContain("Weekly report");
  expect(text).toContain("Evening check");
  const failed = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Weekly report"),
  );
  expect(failed?.className).toContain("destructive");
  await cleanup();
});

it("opens a routine's card, and from it the agent that owns it", async () => {
  calendar.mockResolvedValue({
    occurrences: [occurrence("Morning summary", "done", 1)],
    truncated: false,
  });
  const { container, cleanup } = await renderPage();
  const chip = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Morning summary"),
  )!;
  await act(async () => chip.click());
  const card = container.querySelector<HTMLButtonElement>("[data-testid='card']")!;
  expect(card.textContent).toBe("Morning summary");
  await act(async () => card.click());
  expect(container.querySelector("[data-testid='where']")?.textContent).toBe("/app/b1");
  await cleanup();
});

it("offers a new routine once there is an agent to give it to", async () => {
  calendar.mockResolvedValue({ occurrences: [], truncated: false });
  const { container, cleanup } = await renderPage();
  const create = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("New routine"),
  )!;
  expect(container.querySelector("[data-testid='new-routine']")).toBeNull();
  await act(async () => create.click());
  expect(container.querySelector("[data-testid='new-routine']")).not.toBeNull();
  await cleanup();
});

it("says so when the routines cannot be loaded", async () => {
  calendar.mockRejectedValue(new Error("boom"));
  const { container, cleanup } = await renderPage();
  expect(container.querySelector("[role='alert']")).not.toBeNull();
  await cleanup();
});

it("says at a glance that everything went well, and what is next", async () => {
  calendar.mockResolvedValue({
    occurrences: [
      occurrence("Morning summary", "done", 1),
      occurrence("Evening check", "upcoming", 12, tomorrow()),
    ],
    truncated: false,
  });
  const { container, cleanup } = await renderPage();
  const text = container.textContent ?? "";
  expect(text).toContain("All good");
  expect(text).not.toContain("failed");
  const next = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Next"),
  );
  expect(next?.textContent).toContain("Evening check");
  await cleanup();
});

it("says at a glance what failed, and opens it", async () => {
  calendar.mockResolvedValue({
    occurrences: [
      occurrence("Morning summary", "done", 1),
      occurrence("Weekly report", "failed", 2),
      occurrence("Second report", "failed", 3),
    ],
    truncated: false,
  });
  const { container, cleanup } = await renderPage();
  expect(container.textContent).not.toContain("All good");
  const pill = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("2 failed"),
  )!;
  expect(pill.textContent).toContain("Second report");
  await act(async () => pill.click());
  expect(container.querySelector("[data-testid='card']")?.textContent).toBe("Second report");
  await cleanup();
});

it("lays the week out by the hour, with each entry named for its state", async () => {
  calendar.mockResolvedValue({
    occurrences: [
      occurrence("Morning summary", "done", 1),
      occurrence("Weekly report", "failed", 2),
    ],
    truncated: false,
  });
  const { container, cleanup } = await renderPage();
  expect(container.querySelectorAll("[data-testid='routine-day']")).toHaveLength(7);
  const labels = [...container.querySelectorAll("button[aria-label]")].map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(
    labels.some((label) => label?.startsWith("Morning summary") && label.endsWith("Done")),
  ).toBe(true);
  expect(
    labels.some((label) => label?.startsWith("Weekly report") && label.endsWith("Failed")),
  ).toBe(true);
  await cleanup();
});

it("paints each entry in its bot's color and marks the present in the brand color", async () => {
  calendar.mockResolvedValue({
    occurrences: [occurrence("Morning summary", "done", 1)],
    truncated: false,
  });
  const { container, cleanup } = await renderPage();
  const block = [...container.querySelectorAll<HTMLElement>("button[aria-label]")].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Morning summary"),
  )!;
  expect(block.style.getPropertyValue("--block")).toBe("#3b82f6");
  expect(block.className).not.toContain("border-dashed");
  expect(container.querySelector(".bg-brand")).not.toBeNull();
  await cleanup();
});

it("shows a sleeping rook when there is nothing in the calendar", async () => {
  calendar.mockResolvedValue({ occurrences: [], truncated: false });
  const { container, cleanup } = await renderPage();
  expect(
    container.querySelector("[data-testid='routines-empty'] [data-piece='pawn']"),
  ).not.toBeNull();
  await cleanup();
});
