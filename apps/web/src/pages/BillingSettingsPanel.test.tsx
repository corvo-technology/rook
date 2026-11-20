// @vitest-environment jsdom

import type { BillingStatus, PlanUsage } from "@corvo/contracts";
import { DEFAULT_PLANS } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { text, rpcMock } = vi.hoisted(() => ({
  text: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((out, part, index) => `${out}${index > 0 ? values[index - 1] : ""}${part}`, ""),
  rpcMock: {
    billing: {
      status: vi.fn(),
      whiteLabelCatalog: vi.fn(),
      portal: vi.fn(),
      changePlan: vi.fn(),
      planCheckout: vi.fn(),
    },
    usage: { plan: vi.fn() },
  },
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: text, i18n: { locale: "en" } }),
  Trans: ({ children }: { children: unknown }) => children,
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));
vi.mock("@lingui/core/macro", () => ({ plural: (count: number) => String(count), t: text }));
vi.mock("../lib/sign-out", () => ({ useSignOut: () => ({ logOut: vi.fn(), signingOut: false }) }));

vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));

import { BillingSettingsPanel } from "./BillingSettingsPanel";

const usage = {
  plan: "personal",
  canManage: true,
  plans: Object.values(DEFAULT_PLANS).map(({ extraSeatPriceId: _price, ...plan }) => plan),
} as unknown as PlanUsage;

function status(overrides: Partial<BillingStatus> = {}): BillingStatus {
  return {
    funding: "credits",
    creditPurchasesEnabled: true,
    balanceUsd: 10,
    monthlyAmountCents: null,
    access: true,
    canManage: true,
    trialAvailable: false,
    trialDays: 0,
    state: "none",
    price: null,
    seats: 1,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    hasCustomer: false,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  rpcMock.billing.whiteLabelCatalog.mockResolvedValue(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render(billing: BillingStatus, plans: PlanUsage | null) {
  rpcMock.billing.status.mockResolvedValue(billing);
  if (plans) rpcMock.usage.plan.mockResolvedValue(plans);
  else rpcMock.usage.plan.mockResolvedValue(null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <BillingSettingsPanel />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);
const body = () => container.textContent ?? "";

describe("Billing settings", () => {
  it("shows the plans inline and no monthly credits select when plans are on and none is held", async () => {
    await render(status(), usage);
    expect(container.querySelector('[data-testid="plan-picker"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-subscribe]")).toHaveLength(3);
    expect(container.querySelector('[aria-label="Monthly credits"]')).toBeNull();
    expect(button("Subscribe")).toBeUndefined();
    expect(body()).toContain("$10.00");
    expect(button("Add credits")).toBeDefined();
    expect(button("Refresh")).toBeUndefined();
  });

  it("puts the held plan first with its price, renewal and the two actions", async () => {
    await render(
      status({
        state: "active",
        plan: "team",
        currency: "usd",
        interval: "month",
        aiUseCents: 1000,
        hasCustomer: true,
        currentPeriodEndsAt: "2030-01-15T12:00:00.000Z",
        pendingChange: {
          plan: "personal",
          interval: "month",
          aiUseCents: 1000,
          effectiveAt: "2030-01-15T12:00:00.000Z",
        },
      }),
      usage,
    );
    const section = container.querySelector('[data-testid="plan-section"]') as HTMLElement;
    expect(section.textContent).toContain("Team");
    expect(section.textContent).toContain("$51 / month");
    expect(section.textContent).toContain("Renews Jan 15, 2030");
    expect(section.textContent).toContain("Changes to Personal on Jan 15, 2030");
    expect(button("Change plan")).toBeDefined();
    expect(button("Manage billing")).toBeDefined();
    expect(container.querySelector('[data-testid="plan-picker"]')).toBeNull();
    expect(body()).toContain("AI per month");

    await act(async () => button("Change plan")?.click());
    expect(container.querySelector('[data-testid="plan-picker"]')).not.toBeNull();
    expect(body()).toContain("Current plan");
    rpcMock.billing.changePlan.mockResolvedValue({ ok: true });
    const switchToCompany = container.querySelector(
      '[data-plan="company"] [data-subscribe]',
    ) as HTMLButtonElement;
    await act(async () => switchToCompany.click());
    expect(rpcMock.billing.changePlan).toHaveBeenCalledWith({
      plan: "company",
      interval: "month",
      currency: "usd",
      aiUseCents: 1000,
    });
  });

  it("keeps the monthly credits subscription where the deployment has no plans", async () => {
    await render(status(), null);
    expect(container.querySelector('[data-testid="plan-section"]')).toBeNull();
    expect(container.querySelector('[aria-label="Monthly credits"]')).not.toBeNull();
    expect(button("Subscribe")).toBeDefined();
  });

  it("hides the plan actions from a member who cannot manage billing", async () => {
    await render(
      status({
        state: "active",
        plan: "team",
        currency: "usd",
        interval: "month",
        canManage: false,
      }),
      usage,
    );
    expect(button("Change plan")).toBeUndefined();
    expect(button("Manage billing")).toBeUndefined();
  });
});
