// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const workflows = vi.hoisted(() => vi.fn());
const setSteps = vi.hoisted(() => vi.fn());
const testRun = vi.hoisted(() => vi.fn());
const rpcClient = vi.hoisted(() => ({
  routines: { workflows, setSteps, testRun },
  bootstrap: vi.fn(),
}));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/bootstrap", () => ({
  takeInitialBootstrap: vi.fn().mockResolvedValue({
    bots: [
      { id: "b1", name: "Scout", color: null, status: "idle" },
      { id: "b2", name: "Writer", color: null, status: "idle" },
    ],
  }),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@corvo/ui-web", () => ({
  BotAvatar: () => <span />,
  Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("./NewRoutinePanel", () => ({ NewRoutinePanel: () => null }));
vi.mock("./AddStepDialog", () => ({
  AddStepDialog: ({ onAdd }: { onAdd: (step: { botId: string; instruction: string }) => void }) => (
    <button
      type="button"
      data-testid="confirm-step"
      onClick={() => onAdd({ botId: "b2", instruction: "Send it" })}
    >
      confirm
    </button>
  ),
}));

import { WorkflowsPage } from "./Workflows";

const routine = {
  id: "r1",
  botId: "b1",
  name: "Morning leads",
  prompt: "Find leads",
  active: true,
  crons: ["0 9 * * *"],
  webhookEnabled: false,
  githubEnabled: false,
  messageProvider: null,
  watch: null,
  nextRunAt: new Date(Date.now() + 36 * 60 * 60_000).toISOString(),
  lastRun: { state: "done", at: "2026-02-01T10:00:00.000Z" },
  steps: [
    {
      id: "s2",
      botId: "b2",
      position: 2,
      instruction: "Summarize it",
      lastRun: { state: "failed", at: "2026-02-01T10:05:00.000Z" },
    },
  ],
};

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  workflows.mockReset();
  setSteps.mockReset();
  testRun.mockReset();
  workflows.mockResolvedValue([routine]);
  setSteps.mockResolvedValue({ ok: true });
  testRun.mockResolvedValue({ runId: "run-1" });
});

async function renderPage() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkflowsPage />
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

const click = (element: Element | null | undefined) =>
  act(async () => {
    (element as HTMLElement).click();
  });
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

it("lays a routine out as its first agent followed by each step", async () => {
  const { container, cleanup } = await renderPage();
  const text = container.querySelector('[data-testid="workflow"]')?.textContent ?? "";
  expect(text).toContain("Morning leads");
  expect(text).toContain("Find leads");
  expect(text).toContain("Writer");
  expect(text).toContain("Summarize it");
  await cleanup();
});

it("adds a step after the existing ones", async () => {
  const { container, cleanup } = await renderPage();
  await click(button(container, "Add step"));
  await click(container.querySelector('[data-testid="confirm-step"]'));
  expect(setSteps).toHaveBeenCalledWith({
    routineId: "r1",
    steps: [
      { botId: "b2", instruction: "Summarize it" },
      { botId: "b2", instruction: "Send it" },
    ],
  });
  await cleanup();
});

it("removes a step by saving the others", async () => {
  const { container, cleanup } = await renderPage();
  await click(container.querySelector('button[aria-label="Remove"]'));
  expect(setSteps).toHaveBeenCalledWith({ routineId: "r1", steps: [] });
  await cleanup();
});

it("runs the whole workflow from its first step", async () => {
  const { container, cleanup } = await renderPage();
  await click(button(container, "Run now"));
  expect(testRun).toHaveBeenCalledWith({ routineId: "r1" });
  await cleanup();
});

const links = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="flow-link"]')].map((link) =>
    link.getAttribute("data-state"),
  );

it("shows how each step's newest run went and colors the link after it", async () => {
  const { container, cleanup } = await renderPage();
  const text = container.querySelector('[data-testid="workflow"]')?.textContent ?? "";
  expect(text).toContain("Done · ");
  expect(text).toContain("Failed · ");
  // Trigger to first agent, first agent to step, then the end after the failed step.
  expect(links(container)).toEqual(["done", "done", "failed"]);
  await cleanup();
});

it("shows no state for a step that has never run", async () => {
  workflows.mockResolvedValue([
    { ...routine, lastRun: null, steps: [{ ...routine.steps[0], lastRun: null }] },
  ]);
  const { container, cleanup } = await renderPage();
  const text = container.querySelector('[data-testid="workflow"]')?.textContent ?? "";
  expect(text).not.toContain("Done");
  expect(text).not.toContain("Failed");
  expect(links(container)).toEqual(["idle", "idle", "idle"]);
  await cleanup();
});

it("says what starts the flow and when it runs next", async () => {
  const { container, cleanup } = await renderPage();
  const text = container.querySelector('[data-testid="workflow"]')?.textContent ?? "";
  expect(text).toContain("Trigger");
  expect(text).toContain("9:00");
  expect(text).toContain("Next");
  expect(text).toContain("Active");
  await cleanup();
});

it("says a paused flow is paused and shows no next run", async () => {
  workflows.mockResolvedValue([{ ...routine, active: false }]);
  const { container, cleanup } = await renderPage();
  const text = container.querySelector('[data-testid="workflow"]')?.textContent ?? "";
  expect(text).toContain("Paused");
  expect(text).not.toContain("Next");
  await cleanup();
});

it("adds a step between two steps, not only at the end", async () => {
  const { container, cleanup } = await renderPage();
  await click(container.querySelector('button[aria-label="Add a step here"]'));
  await click(container.querySelector('[data-testid="confirm-step"]'));
  expect(setSteps).toHaveBeenCalledWith({
    routineId: "r1",
    steps: [
      { botId: "b2", instruction: "Send it" },
      { botId: "b2", instruction: "Summarize it" },
    ],
  });
  await cleanup();
});

it("moves a step earlier or later by saving the new order", async () => {
  const second = { ...routine.steps[0], id: "s3", botId: "b1", instruction: "Check it" };
  workflows.mockResolvedValue([{ ...routine, steps: [routine.steps[0], second] }]);
  const { container, cleanup } = await renderPage();
  const later = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Move later"]');
  expect(later[0]?.disabled).toBe(false);
  expect(later[1]?.disabled).toBe(true);
  await click(later[0]);
  expect(setSteps).toHaveBeenCalledWith({
    routineId: "r1",
    steps: [
      { botId: "b1", instruction: "Check it" },
      { botId: "b2", instruction: "Summarize it" },
    ],
  });
  const earlier = container.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Move earlier"]',
  );
  expect(earlier[0]?.disabled).toBe(true);
  await cleanup();
});

it("says so when there are no workflows yet", async () => {
  workflows.mockResolvedValue([]);
  const { container, cleanup } = await renderPage();
  expect(container.textContent).toContain("No workflows yet");
  expect(container.querySelector('[data-testid="workflow"]')).toBeNull();
  await cleanup();
});
