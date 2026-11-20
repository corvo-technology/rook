// @vitest-environment jsdom

import type { BillingStatus, PlanUsage } from "@corvo/contracts";
import { DEFAULT_PLANS } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@lingui/core/macro", () => ({
  plural: (count: number) => String(count),
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, ""),
}));
vi.mock("../lib/sign-out", () => ({ useSignOut: () => ({ logOut: vi.fn(), signingOut: false }) }));
const planCheckout = vi.fn();
vi.mock("../lib/rpc", () => ({
  rpc: { billing: { planCheckout: (...a: unknown[]) => planCheckout(...a) } },
}));

import { PlanChoice } from "./PlanChoice";

const usage = {
  canManage: true,
  plans: Object.values(DEFAULT_PLANS).map(
    ({ extraSeatPriceId: _seat, extraComputerPriceId: _computer, ...plan }) => plan,
  ),
} as unknown as PlanUsage;
const status = { canManage: true } as unknown as BillingStatus;

let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();

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
  vi.stubGlobal("location", { assign });
  planCheckout.mockReset();
  assign.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const subscribeButtons = () => [
  ...container.querySelectorAll<HTMLButtonElement>("[data-subscribe]"),
];
const alertText = () => container.querySelector('[role="alert"]')?.textContent;

async function render() {
  await act(async () => root.render(<PlanChoice status={status} usage={usage} />));
}
const click = (button: HTMLButtonElement | undefined) =>
  act(async () => {
    button?.click();
  });

describe("PlanChoice subscribe", () => {
  it("marks the clicked plan busy and disables every subscribe button", async () => {
    planCheckout.mockReturnValue(new Promise(() => {}));
    await render();
    await click(subscribeButtons()[1]);
    const buttons = subscribeButtons();
    expect(buttons.map((b) => b.getAttribute("aria-busy"))).toEqual([null, "true", null]);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("opens one checkout when clicked twice", async () => {
    planCheckout.mockReturnValue(new Promise(() => {}));
    await render();
    const [first] = subscribeButtons();
    await act(async () => {
      first?.click();
      first?.click();
    });
    expect(planCheckout).toHaveBeenCalledTimes(1);
  });

  it("goes to the checkout url and keeps loading", async () => {
    planCheckout.mockResolvedValue({ url: "https://checkout.example/session" });
    await render();
    await click(subscribeButtons()[0]);
    expect(assign).toHaveBeenCalledWith("https://checkout.example/session");
    expect(subscribeButtons()[0]?.getAttribute("aria-busy")).toBe("true");
    expect(subscribeButtons().every((b) => b.disabled)).toBe(true);
  });

  it("shows one short error and re-enables the buttons when it fails", async () => {
    planCheckout.mockRejectedValue(new Error("Stripe 400: Terms of service URL"));
    await render();
    await click(subscribeButtons()[0]);
    expect(alertText()).toBe("Could not open checkout. Try again.");
    expect(container.textContent).not.toContain("Stripe");
    expect(assign).not.toHaveBeenCalled();
    expect(subscribeButtons().every((b) => !b.disabled && !b.hasAttribute("aria-busy"))).toBe(true);
    planCheckout.mockResolvedValue({ url: "https://checkout.example/again" });
    await click(subscribeButtons()[0]);
    expect(alertText()).toBeUndefined();
    expect(assign).toHaveBeenCalledWith("https://checkout.example/again");
  });
});
