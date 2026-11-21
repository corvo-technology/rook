// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const rpcClient = vi.hoisted(() => ({ threads: { get }, bootstrap: vi.fn() }));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/bootstrap", () => ({
  takeInitialBootstrap: vi.fn().mockResolvedValue({
    bots: [{ id: "chief", name: "Chief", color: "blue", status: "idle" }],
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
  AgentLoader: ({ label }: { label?: string }) => (
    <span role="status" aria-label={label ?? "Loading…"} />
  ),
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));

import { SquadPage } from "./SquadPage";

const member = (botId: string, name: string, status = "idle") => ({
  botId,
  name,
  color: "blue",
  status,
});

const snapshot = {
  threadId: "thread-1",
  cursor: 5,
  olderCursor: null,
  groupId: "group-1",
  groupName: "Product",
  run: null,
  members: [
    member("copy", "Copy"),
    member("design", "Design", "running"),
    member("research", "Research"),
  ],
  messages: [
    {
      id: "m1",
      threadId: "thread-1",
      seq: 1,
      role: "bot",
      botId: "chief",
      blocks: [
        {
          kind: "handoff",
          fromBotId: "chief",
          toBotId: "research",
          text: "Read the landing",
          reason: "Fits a landing review",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "m2",
      threadId: "thread-1",
      seq: 2,
      role: "bot",
      botId: "research",
      blocks: [
        { kind: "steps", steps: [{ label: "browser", count: 2 }] },
        { kind: "text", text: "12 sections" },
      ],
      createdAt: "2026-01-01T00:00:01.000Z",
    },
    {
      id: "m3",
      threadId: "thread-1",
      seq: 3,
      role: "bot",
      botId: "research",
      blocks: [
        { kind: "handoff", fromBotId: "research", toBotId: "design", text: "Review the hero" },
      ],
      createdAt: "2026-01-01T00:00:02.000Z",
    },
  ],
};

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
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
        <MemoryRouter initialEntries={["/app/g/group-1/squad"]}>
          <Where />
          <Routes>
            <Route path="/app/g/:groupId/squad" element={<SquadPage />} />
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

it("shows one lane per bot in the order work reached them, with the Chief's reason on top", async () => {
  get.mockResolvedValue(snapshot);
  const { container, cleanup } = await renderPage();
  const lanes = [...container.querySelectorAll('[data-testid^="squad-lane-"]')];
  expect(lanes.map((lane) => lane.getAttribute("data-testid"))).toEqual([
    "squad-lane-research",
    "squad-lane-design",
    "squad-lane-copy",
  ]);
  expect(container.querySelector('[data-testid="squad-router"]')?.textContent).toContain("Chief");
  expect(container.querySelector('[data-testid="squad-router"]')?.textContent).toContain(
    "Fits a landing review",
  );
  expect(lanes[0]?.textContent).toContain("Done");
  expect(lanes[1]?.textContent).toContain("Working…");
  expect(lanes[1]?.textContent).toContain("Review the hero");
  expect(lanes[2]?.textContent).toContain("Waiting…");
  expect(lanes[0]?.textContent).toContain("browser ×2");
  await cleanup();
});

it("asks the group thread by its id", async () => {
  get.mockResolvedValue(snapshot);
  const { cleanup } = await renderPage();
  expect(get).toHaveBeenCalledWith({ groupId: "group-1" }, expect.anything());
  await cleanup();
});

it("opens a bot from its lane", async () => {
  get.mockResolvedValue(snapshot);
  const { container, cleanup } = await renderPage();
  const open = container.querySelector<HTMLButtonElement>(
    '[data-testid="squad-lane-design"] button',
  );
  await act(async () => open?.click());
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/app/design");
  await cleanup();
});

it("goes back to the group chat", async () => {
  get.mockResolvedValue(snapshot);
  const { container, cleanup } = await renderPage();
  const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
  await act(async () => back?.click());
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe("/app/g/group-1");
  await cleanup();
});

it("shows no router bar when only members handed work around", async () => {
  get.mockResolvedValue({
    ...snapshot,
    messages: [snapshot.messages[2]],
  });
  const { container, cleanup } = await renderPage();
  expect(container.querySelector('[data-testid="squad-router"]')).toBeNull();
  await cleanup();
});
