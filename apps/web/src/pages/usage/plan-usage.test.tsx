// @vitest-environment jsdom

import type { PlanUsage } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
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
  Button: (props: ComponentProps<"button">) => <button {...props} />,
  Progress: ({ value, children, ...props }: ComponentProps<"div"> & { value: number }) => (
    <div role="progressbar" aria-valuenow={value} {...props}>
      {children}
    </div>
  ),
}));
vi.mock("../../lib/query", () => ({ useSpaceQueries: () => ({}) }));

import { PlanUsageView } from "./plan-usage";

const GIB = 1024 ** 3;
const plan = (usedBytes: number, overrides: Partial<PlanUsage> = {}): PlanUsage => ({
  plan: "team",
  computerSize: "medium",
  computers: { used: 2, limit: 3, included: 1, extra: 2, extraPrice: null },
  storage: { usedBytes, limitBytes: 100 * GIB },
  seats: { used: 7, included: 10, max: 15, extraPrice: null },
  plans: [],
  canManage: true,
  ...overrides,
});

function render(usage: PlanUsage) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<PlanUsageView plan={usage} />));
  return host;
}

it("shows storage against the plan's limit and the plan's computers", () => {
  const host = render(plan(12.5 * GIB));
  expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("12");
  expect(host.textContent).toContain("12.5 GB of 100 GB");
  expect(host.textContent).toContain("2 of 3");
  expect(host.textContent).toContain("7 of 15");
  expect(host.textContent).toContain("Medium");
  expect(host.textContent).toContain("4 CPU");
  expect(host.querySelector("button")).toBeNull();
});

it("offers the upgrade to an owner from 80% and not to anyone else", () => {
  const owner = render(plan(85 * GIB));
  const button = owner.querySelector("button");
  expect(button?.textContent).toBe("Upgrade");
  act(() => button?.click());
  expect(navigate).toHaveBeenCalledWith("/settings/billing");

  const member = render(plan(100 * GIB, { canManage: false }));
  expect(member.querySelector("button")).toBeNull();
});
