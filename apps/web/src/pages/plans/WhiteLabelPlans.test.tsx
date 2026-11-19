// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  whiteLabelCatalog: vi.fn(),
  whiteLabelCheckout: vi.fn(),
  whiteLabelChangePlan: vi.fn(),
  whiteLabelPortal: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { billing: api } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

import { WhiteLabelPlans } from "./WhiteLabelPlans";

const plans = [
  { key: "team", name: "Team", creditMinor: 4_000, priceMinor: 13_000 },
  { key: "company", name: "Company", creditMinor: 9_000, priceMinor: 23_000 },
];
const packs = [{ key: "pack_m", name: "Medium", creditMinor: 5_000, priceMinor: 13_000 }];
const catalog = (over: object = {}) => ({
  currency: "BRL",
  plans,
  packs,
  subscription: null,
  canPay: true,
  ...over,
});

let root: Root;
let container: HTMLElement;

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
}
async function render(path = "/app/plans") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/plans" element={<WhiteLabelPlans />} />
            <Route path="/app/home" element={<div data-testid="home" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
}
async function click(el: HTMLElement | undefined) {
  expect(el).toBeTruthy();
  await act(async () => el?.click());
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  container.remove();
});

describe("white label plans", () => {
  it("shows the partner's prices and opens the checkout of the plan chosen", async () => {
    api.whiteLabelCatalog.mockResolvedValue(catalog());
    api.whiteLabelCheckout.mockResolvedValue({ url: "https://checkout.example.test/c" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await render();
    expect(container.querySelector('[data-testid="plan-team"]')?.textContent).toContain("130");
    expect(container.querySelector('[data-testid="plans-topups"]')).toBeNull();
    await click(
      container.querySelector<HTMLElement>('[data-testid="plan-team"] button') ?? undefined,
    );
    expect(api.whiteLabelCheckout).toHaveBeenCalledWith({ kind: "plan", key: "team" });
    expect(assign).toHaveBeenCalledWith("https://checkout.example.test/c");
  });

  it("offers top-ups, the card and a plan change once a plan is in force", async () => {
    api.whiteLabelCatalog.mockResolvedValue(
      catalog({
        subscription: {
          planKey: "team",
          pendingPlanKey: null,
          state: "active",
          periodEnd: "2026-12-01T00:00:00.000Z",
        },
      }),
    );
    api.whiteLabelChangePlan.mockResolvedValue({ effective: "now" });
    api.whiteLabelCheckout.mockResolvedValue({ url: "https://checkout.example.test/t" });
    await render();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="plan-team"] button')?.disabled,
    ).toBe(true);
    await click(
      container.querySelector<HTMLElement>('[data-testid="plan-company"] button') ?? undefined,
    );
    expect(api.whiteLabelChangePlan).toHaveBeenCalledWith({ key: "company" });
    expect(api.whiteLabelCheckout).not.toHaveBeenCalled();
    const topups = container.querySelector('[data-testid="plans-topups"]');
    expect(topups).toBeTruthy();
    await click(
      [...topups!.querySelectorAll<HTMLElement>("button")].find((b) =>
        b.textContent?.includes("Medium"),
      ),
    );
    expect(api.whiteLabelCheckout).toHaveBeenCalledWith({
      kind: "pack",
      key: "pack_m",
      quantity: 1,
    });
  });

  it("cannot buy before the partner can take payments", async () => {
    api.whiteLabelCatalog.mockResolvedValue(catalog({ canPay: false }));
    await render();
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>('[data-testid="plans-list"] button'),
    ];
    expect(buttons.length).toBe(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("waits for the confirmed payment after the checkout, then opens the app", async () => {
    api.whiteLabelCatalog.mockResolvedValue(catalog());
    await render("/app/plans?checkout=success");
    expect(container.querySelector('[data-testid="plans-confirming"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="home"]')).toBeNull();

    api.whiteLabelCatalog.mockResolvedValue(
      catalog({
        subscription: {
          planKey: "team",
          pendingPlanKey: null,
          state: "active",
          periodEnd: "2026-12-01T00:00:00.000Z",
        },
      }),
    );
    await act(async () => new Promise((done) => setTimeout(done, 2_200)));
    await settle();
    expect(container.querySelector('[data-testid="home"]')).toBeTruthy();
  });

  it("says there are no plans to anyone who is not a customer", async () => {
    api.whiteLabelCatalog.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("No plans");
  });
});
