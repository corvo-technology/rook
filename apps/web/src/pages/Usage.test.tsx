// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const overview = vi.hoisted(() => vi.fn());
const budgets = vi.hoisted(() => vi.fn());
const plan = vi.hoisted(() => vi.fn(async () => null));
const rpcClient = vi.hoisted(() => ({ usage: { overview, budgets, plan } }));
vi.mock("../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../lib/run-error", () => ({
  translateRunError: (message: string, values: Record<string, string> = {}) =>
    message.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ""),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@corvo/ui-web", () => ({
  Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
  AgentLoader: ({ label }: { label?: string }) => (
    <span role="status" aria-label={label ?? "Loading…"} />
  ),
  Button: (props: ComponentProps<"button">) => <button {...props} />,
  BotAvatar: () => <span data-testid="avatar" />,
  Progress: ({ value, children, ...props }: ComponentProps<"div"> & { value: number }) => (
    <div role="progressbar" aria-valuenow={value} {...props}>
      {children}
    </div>
  ),
}));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));

import { UsagePage } from "./Usage";

const DAY = "2026-11-02";
const data = {
  period: "month",
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-11-15T12:00:00.000Z",
  tokens: 1_500_000,
  previousTokens: 1_000_000,
  replies: 12,
  costUsd: 0,
  cache: { input: 100_000, cacheRead: 900_000, cacheWrite: 0, output: 500_000 },
  agents: [
    {
      id: "a",
      cache: { input: 100_000, cacheRead: 300_000, cacheWrite: 100_000, output: 500_000 },
      name: "Pia",
      color: "#10B981",
      tokens: 1_000_000,
      replies: 8,
      costUsd: 0,
      failed: 2,
      avgSeconds: 12,
      topError: '429 {"error":{"message":"rate limit"}}',
      failureKinds: { limit: 2 },
      models: [{ provider: "anthropic", model: "Sonnet", tokens: 1_000_000 }],
    },
    {
      id: "b",
      name: "",
      color: null,
      tokens: 500_000,
      replies: 4,
      costUsd: 0,
      models: [],
    },
  ],
  days: [
    { date: "2026-11-01", tokens: 0, agents: {} },
    { date: DAY, tokens: 1_500_000, agents: { a: 1_000_000, b: 500_000 } },
  ],
};

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  overview.mockReset();
  budgets.mockReset();
  budgets.mockResolvedValue([]);
});

async function render() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <UsagePage />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

it("shows the period's tokens, how it compares and who used them", async () => {
  overview.mockResolvedValue(data);
  const { host, root } = await render();
  expect(overview.mock.calls[0]?.[0]).toEqual({ period: "month" });
  expect(host.textContent).toContain("1.5M");
  expect(host.textContent).toContain("+50%");
  expect(host.textContent).toContain("vs. the same days last month");
  expect(host.textContent).toContain("Pia");
  expect(host.textContent).toContain("Sonnet · 8 replies · 60% cached");
  // The raw provider text never reaches the page; the count opens into a short reason.
  expect(host.textContent).toContain("2 failed");
  expect(host.textContent).not.toContain('rate limit"');
  expect(host.textContent).not.toContain("Limit reached");
  const failed = [...host.querySelectorAll("button")].find((b) => b.textContent === "2 failed");
  await act(async () => failed?.click());
  expect(host.textContent).toContain("Limit reached 2");
  // An agent with no failures says nothing about them.
  expect(host.textContent).not.toContain("0 failed");
  // An agent that no longer exists is still listed, with a name for it.
  expect(host.textContent).toContain("Deleted agent");
  await act(async () => root.unmount());
});

it("splits what was billed from what the prompt cache served, for the period and one agent", async () => {
  overview.mockResolvedValue(data);
  const { host, root } = await render();
  const billed = () => host.querySelector('section[aria-label="Tokens"]')?.textContent ?? "";
  expect(billed()).toContain("Input100K");
  expect(billed()).toContain("Cached900K");
  expect(billed()).not.toContain("Cache writes");
  expect(billed()).toContain("Cache hit rate90%");
  expect(host.textContent).toContain("60% cached");
  const row = [...host.querySelectorAll("button[aria-pressed]")].find((b) =>
    b.textContent?.includes("Pia"),
  );
  await act(async () => (row as HTMLElement).click());
  expect(billed()).toContain("Cache writes100K");
  expect(billed()).toContain("Cache hit rate60%");
  await act(async () => root.unmount());
});

const spendData = {
  ...data,
  spend: { creditsUsd: 8, ownUsd: 4.4, ownEstimatedUsd: 4.4 },
  previousSpendUsd: 6,
  agents: [
    { ...data.agents[0], spendUsd: 9 },
    { ...data.agents[1], spendUsd: 3.4 },
    { id: "idle", name: "Idle", color: null, tokens: 5, replies: 0, costUsd: 0, models: [] },
  ],
  accounts: [
    {
      provider: "openai-codex",
      model: "model-y",
      funding: "own",
      calls: 30,
      tokens: 900,
      spendUsd: 4.4,
      estimated: true,
      cache: { input: 1, cacheRead: 9, cacheWrite: 0, output: 1 },
    },
  ],
  days: [
    { date: "2026-11-01", tokens: 0, agents: {}, spendUsd: 0, agentSpendUsd: {} },
    {
      date: DAY,
      tokens: 1_500_000,
      agents: { a: 1_000_000, b: 500_000 },
      spendUsd: 12.4,
      agentSpendUsd: { a: 9, b: 3.4 },
    },
  ],
};

it("leads with the money spent, split by who paid, and compares it with the period before", async () => {
  overview.mockResolvedValue(spendData);
  const { host, root } = await render();
  expect(host.textContent).toContain("$12.40");
  expect(host.textContent).toContain("Rook credits$8.00");
  expect(host.textContent).toContain("Your accounts≈ $4.40");
  expect(host.textContent).toContain("+107%");
  // Agents lead with spend and an agent with no replies and no spend is left out.
  expect(host.textContent).toContain("$9.00");
  expect(host.textContent).not.toContain("Idle");
  expect(host.textContent).toContain("ChatGPT subscription · 30 calls · 90% cached");
  const row = [...host.querySelectorAll("button[aria-pressed]")].find((b) =>
    b.textContent?.includes("Pia"),
  ) as HTMLButtonElement;
  await act(async () => row.click());
  expect(host.querySelector("figure p")?.textContent).toBe("Pia · $9.00");
  await act(async () => root.unmount());
});

it("asks for another period and starts over", async () => {
  overview.mockResolvedValue(data);
  const { host, root } = await render();
  const last = [...host.querySelectorAll("button")].find((b) => b.textContent === "Last month");
  await act(async () => last?.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(overview.mock.calls.at(-1)?.[0]).toEqual({ period: "last-month" });
  await act(async () => root.unmount());
});

it("picks an agent and names it above the chart", async () => {
  overview.mockResolvedValue(data);
  const { host, root } = await render();
  const row = [...host.querySelectorAll("button[aria-pressed]")].find((b) =>
    b.textContent?.includes("Pia"),
  ) as HTMLButtonElement;
  await act(async () => row.click());
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector("figure p")?.textContent).toBe("Pia · 1M tokens");
  await act(async () => root.unmount());
});

it("says so when nothing was used", async () => {
  overview.mockResolvedValue({ ...data, tokens: 0, previousTokens: 0, agents: [], days: [] });
  const { host, root } = await render();
  expect(host.textContent).toContain("No use in this period.");
  await act(async () => root.unmount());
});

it("leaves out the share bar when one agent has all the use, since it would only say 100%", async () => {
  overview.mockResolvedValue({ ...data, agents: [data.agents[0]] });
  const { host, root } = await render();
  expect(host.querySelector("span.h-\\[3px\\]")).toBeNull();
  await act(async () => root.unmount());
});

it("shows this month's tokens against a bot's limit", async () => {
  overview.mockResolvedValue(data);
  budgets.mockResolvedValue([{ botId: "a", monthTokens: 1_200_000, monthlyTokenLimit: 2_000_000 }]);
  const { host, root } = await render();
  expect(host.textContent).toContain("1,200,000 of 2,000,000");
  const bars = host.querySelectorAll('[role="progressbar"]');
  expect(bars).toHaveLength(1);
  expect(bars[0]?.getAttribute("aria-valuenow")).toBe("60");
  await act(async () => root.unmount());
});

it("shows no budget for a bot without a limit", async () => {
  overview.mockResolvedValue(data);
  const { host, root } = await render();
  expect(host.textContent).not.toContain(" of 2,000,000");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  await act(async () => root.unmount());
});

it("stops the bar at 100 when the month is over the limit", async () => {
  overview.mockResolvedValue(data);
  budgets.mockResolvedValue([{ botId: "a", monthTokens: 3_000_000, monthlyTokenLimit: 2_000_000 }]);
  const { host, root } = await render();
  expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
  await act(async () => root.unmount());
});
