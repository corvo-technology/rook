// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const overview = vi.hoisted(() => vi.fn());
const budgets = vi.hoisted(() => vi.fn());
const rpcClient = vi.hoisted(() => ({ usage: { overview, budgets } }));
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
  agents: [
    {
      id: "a",
      name: "Pia",
      color: "#10B981",
      tokens: 1_000_000,
      replies: 8,
      costUsd: 0,
      failed: 2,
      avgSeconds: 12,
      topError: '429 {"error":{"message":"rate limit"}}',
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
  expect(host.textContent).toContain("Sonnet · 8 replies · 12 s avg · 2 failed: ");
  expect(host.textContent).toContain("rate limiting requests");
  // An agent with no failures says nothing about them.
  expect(host.textContent).not.toContain("0 failed");
  // An agent that no longer exists is still listed, with a name for it.
  expect(host.textContent).toContain("Deleted agent");
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
