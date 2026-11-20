// @vitest-environment jsdom

import type { PlanUsage } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { text, rpcMock, openSettings } = vi.hoisted(() => ({
  text: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((out, part, index) => `${out}${index > 0 ? values[index - 1] : ""}${part}`, ""),
  rpcMock: { usage: { plan: vi.fn() }, billing: { setExtraComputers: vi.fn() } },
  openSettings: vi.fn(),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: text, i18n: { locale: "en" } }),
}));
vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("../lib/settings-route", () => ({ useOpenSettings: () => openSettings }));

import { ComputerLimitAction } from "./ExtraComputers";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

async function mount(plan: Partial<PlanUsage> | null) {
  rpcMock.usage.plan.mockResolvedValue(plan);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ComputerLimitAction />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const offered = { amount: 900, currency: "usd", interval: "month" };
const computers = (extraPrice: typeof offered | null) => ({
  used: 1,
  limit: 1,
  included: 1,
  extra: 0,
  extraPrice,
});

describe("the action when the plan has no room for another computer", () => {
  it("offers the owner one action: add a computer, in billing", async () => {
    await mount({ canManage: true, computers: computers(offered) });
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Add computer");
    await act(async () => buttons[0]?.click());
    expect(openSettings).toHaveBeenCalledWith("billing");
    expect(container.textContent).not.toContain("Upgrade");
  });

  it("tells anyone else only the owner can add one", async () => {
    await mount({ canManage: false, computers: computers(offered) });
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe("Only the owner can add computers.");
  });

  it("shows nothing where plans are off or extra computers are not offered", async () => {
    await mount(null);
    expect(container.textContent).toBe("");
    await mount({ canManage: true, computers: computers(null) });
    expect(container.textContent).toBe("");
  });
});
