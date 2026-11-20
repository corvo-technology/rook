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
      setExtraComputers: vi.fn(),
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
  computers: { used: 1, limit: 1, included: 1, extra: 0, extraPrice: null },
  plans: Object.values(DEFAULT_PLANS).map(
    ({ extraSeatPriceId: _seat, extraComputerPriceId: _computer, ...plan }) => plan,
  ),
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

  describe("extra computers", () => {
    const active = status({
      state: "active",
      plan: "team",
      currency: "usd",
      interval: "month",
      hasCustomer: true,
    });
    const withComputers = (computers: Partial<PlanUsage["computers"]>, canManage = true) =>
      ({
        ...usage,
        canManage,
        computers: {
          used: 2,
          limit: 3,
          included: 1,
          extra: 2,
          extraPrice: { amount: 900, currency: "usd", interval: "month" },
          ...computers,
        },
      }) as unknown as PlanUsage;

    it("shows computers in use out of allowed and adds or removes one for the owner", async () => {
      rpcMock.billing.setExtraComputers.mockResolvedValue({ ok: true });
      await render(active, withComputers({}));
      expect(body()).toContain("2 of 3");
      expect(body()).toContain("$9 / month");
      await act(async () => button("Add computer")?.click());
      expect(rpcMock.billing.setExtraComputers).toHaveBeenLastCalledWith({ quantity: 3 });
      await act(async () => button("Remove computer")?.click());
      expect(rpcMock.billing.setExtraComputers).toHaveBeenLastCalledWith({ quantity: 1 });
    });

    it("keeps the computers running: nothing to remove when every place is taken", async () => {
      await render(active, withComputers({ used: 3 }));
      expect(button("Remove computer")?.disabled).toBe(true);
      await render(active, withComputers({ extra: 0, limit: 1, used: 0 }));
      expect(button("Remove computer")?.disabled).toBe(true);
    });

    it("opens the portal when the payment needs the owner", async () => {
      const assign = vi.fn();
      vi.stubGlobal("location", { assign });
      rpcMock.billing.setExtraComputers.mockResolvedValue({
        ok: true,
        url: "https://billing.example.com/portal",
      });
      await render(active, withComputers({}));
      await act(async () => button("Add computer")?.click());
      expect(assign).toHaveBeenCalledWith("https://billing.example.com/portal");
    });

    it("gives a member the count and no buttons, and nothing where none can be bought", async () => {
      await render(active, withComputers({}, false));
      expect(body()).toContain("2 of 3");
      expect(button("Add computer")).toBeUndefined();
      await render(active, withComputers({ extra: 0, extraPrice: null }));
      expect(body()).not.toContain("Remove computer");
    });
  });
});
