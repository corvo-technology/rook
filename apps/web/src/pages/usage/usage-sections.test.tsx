// @vitest-environment jsdom

import type { UsageAccount, UsageOverview } from "@corvo/contracts";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return { useLingui: () => ({ t, i18n: { locale: "en" } }) };
});
vi.mock("@corvo/ui-web", () => ({
  BotAvatar: () => <span />,
  Progress: ({ children }: ComponentProps<"div">) => <div role="progressbar">{children}</div>,
}));

import { AccountList, AgentList, SpendLead, TokenStats } from "./usage-sections";

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(node));
  return host;
}
const click = (element: Element | null | undefined) =>
  act(() => element?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

it("leads with the total and splits credits from the user's own accounts, marking the estimate", () => {
  const host = render(
    <SpendLead spend={{ creditsUsd: 8, ownUsd: 4.4, ownEstimatedUsd: 4.4 }} locale="en" />,
  );
  expect(host.textContent).toContain("$12.40");
  expect(host.textContent).toContain("Rook credits$8.00");
  expect(host.textContent).toContain("Your accounts≈ $4.40");
});

it("shows no estimate mark when the user's own spend was reported, and no split line for zero", () => {
  const host = render(
    <SpendLead spend={{ creditsUsd: 0, ownUsd: 3, ownEstimatedUsd: 0 }} locale="en" />,
  );
  expect(host.textContent).toContain("Your accounts$3.00");
  expect(host.textContent).not.toContain("≈");
  expect(host.textContent).not.toContain("Rook credits");
});

it("puts the tokens in one row", () => {
  const host = render(
    <TokenStats cache={{ input: 100, cacheRead: 300, cacheWrite: 0, output: 50 }} locale="en" />,
  );
  expect(host.querySelectorAll("dt")).toHaveLength(4);
  expect(host.textContent).toContain("Cache hit rate");
  expect(host.textContent).toContain("75%");
  expect(host.textContent).not.toContain("Cache writes");
});

const agent = (n: number, over: Partial<UsageOverview["agents"][number]> = {}) => ({
  id: `a${n}`,
  name: `Agent ${n}`,
  color: null,
  tokens: 1_000,
  replies: 4,
  costUsd: null,
  spendUsd: 20 - n,
  models: [{ provider: "openrouter", model: "model-x", tokens: 1_000 }],
  ...over,
});

function agentList(agents: UsageOverview["agents"]) {
  return render(
    <AgentList
      agents={agents}
      total={100}
      selected={null}
      onSelect={() => {}}
      agentName={(name) => name}
      budgetOf={() => undefined}
      budgetLine={() => ""}
      spendMode
    />,
  );
}

it("shows money first and folds agents beyond the top eight behind a count", () => {
  const host = agentList(Array.from({ length: 11 }, (_, index) => agent(index)));
  expect(host.querySelectorAll("li button[aria-pressed]")).toHaveLength(8);
  expect(host.textContent).toContain("$20.00");
  expect(host.textContent).toContain("model-x · 4 replies");
  const more = [...host.querySelectorAll("button")].find((b) => b.textContent === "3 more");
  click(more);
  expect(host.querySelectorAll("li button[aria-pressed]")).toHaveLength(11);
  expect(host.textContent).not.toContain("3 more");
});

it("counts failures in the row and names their kinds only when asked", () => {
  const host = agentList([agent(1, { failed: 3, failureKinds: { billing: 2, limit: 1 } })]);
  const count = [...host.querySelectorAll("button")].find((b) => b.textContent === "3 failed");
  expect(host.textContent).not.toContain("Billing");
  click(count);
  expect(host.textContent).toContain("Billing 2 · Limit reached 1");
  expect(host.textContent).not.toContain("Insufficient");
});

const account = (over: Partial<UsageAccount>): UsageAccount => ({
  provider: "openrouter",
  model: "model-x",
  funding: "own",
  calls: 12,
  tokens: 1,
  spendUsd: 1.5,
  estimated: false,
  cache: { input: 10, cacheRead: 90, cacheWrite: 0, output: 5 },
  ...over,
});

it("names each model's account and marks estimated spend", () => {
  const host = render(
    <AccountList
      accounts={[
        account({ funding: "credits", spendUsd: 7.86 }),
        account({ provider: "openai-codex", model: "model-y", estimated: true, spendUsd: 0.36 }),
      ]}
    />,
  );
  expect(host.textContent).toContain("Rook credits · 12 calls · 90% cached");
  expect(host.textContent).toContain("ChatGPT subscription · 12 calls");
  expect(host.textContent).toContain("≈ $0.36");
  expect(host.textContent).toContain("$7.86");
  expect(host.textContent).not.toContain("≈ $7.86");
});
