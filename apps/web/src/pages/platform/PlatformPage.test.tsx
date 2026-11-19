// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  partnerPricing: { get: vi.fn(), history: vi.fn(), publish: vi.fn(), simulate: vi.fn() },
  partners: { list: vi.fn(), create: vi.fn() },
  partnerPlan: { set: vi.fn() },
  partnerBranding: { get: vi.fn() },
  waitlist: { list: vi.fn(), decide: vi.fn() },
  partnerLeads: { list: vi.fn(), approve: vi.fn(), decline: vi.fn() },
  invoices: { list: vi.fn(), draft: vi.fn(), setState: vi.fn() },
  limits: { get: vi.fn(), set: vi.fn() },
}));
const operator = vi.hoisted(() => ({ value: true as boolean | undefined }));
const rpcClient = vi.hoisted(() => ({ platform }));
vi.mock("../../lib/rpc", () => ({
  rpc: rpcClient,
  rpcForSpace: () => rpcClient,
  createSpaceRpc: () => rpcClient,
  selectedSpaceId: () => null,
}));
vi.mock("../shell/sidebar-team", () => ({ usePartnerAdmin: () => operator.value }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

import { PlatformPage } from "./PlatformPage";

const config = {
  tiers: [
    {
      key: "starter",
      name: "Starter",
      prices: {
        BRL: { priceMinor: 100_000, includedCredits: 20_000 },
        USD: { priceMinor: 20_000, includedCredits: 20_000 },
      },
    },
  ],
  costs: {
    models: { sonnet: { inputPer1MMicros: 3_000_000, outputPer1MMicros: 15_000_000 } },
    voiceMinuteMicros: 90_000,
    computerMinuteMicros: 10_000,
    storageGbMonthMicros: 20_000,
  },
  margins: {
    tokensBps: 3000,
    perModelBps: {},
    voiceBps: 3000,
    computerMinuteBps: 3000,
    storageBps: 3000,
  },
  storageAllowanceGb: 5,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};
const simulation = {
  creditsPerCustomer: 250,
  costPerCustomer: { modelsMicros: 1_000_000, infraMicros: 500_000 },
  marginPerCustomerMicros: 450_000,
  customersSupported: 80,
  fund: { creditsNeeded: 2500, covered: true, shortfallCredits: 0 },
  totalMarginMicros: 4_500_000,
  planMarginMicros: null,
};

let container: HTMLDivElement;
let client: QueryClient;

async function open(path: string) {
  container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/platform/:section?" element={<PlatformPage />} />
            <Route path="/app/home" element={<p>home</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
}

async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function change(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const field = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) as HTMLInputElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = "";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  operator.value = true;
  platform.partnerPricing.get.mockReset().mockResolvedValue({
    version: 3,
    config,
    createdAt: "2026-11-01T12:00:00.000Z",
    effectiveAt: "2026-11-01T12:00:00.000Z",
  });
  platform.partnerPricing.history.mockReset().mockResolvedValue([
    {
      version: 4,
      createdAt: "2026-11-05T12:00:00.000Z",
      effectiveAt: "2999-01-01T00:00:00.000Z",
      status: "scheduled",
    },
    {
      version: 3,
      createdAt: "2026-11-01T12:00:00.000Z",
      effectiveAt: "2026-11-01T12:00:00.000Z",
      status: "live",
    },
  ]);
  platform.partnerPricing.publish.mockReset().mockResolvedValue({ version: 4 });
  platform.partnerPricing.simulate.mockReset().mockResolvedValue(simulation);
  platform.partners.list.mockReset().mockResolvedValue([
    {
      id: "p1",
      slug: "alpha",
      name: "Alpha",
      mode: "embedded",
      activeCustomers: 4,
      fundBalanceCredits: 600,
      fundPercent: 60,
      chargedCredits: 10_000,
      costCredits: 6_000,
    },
    {
      id: "p2",
      slug: "beta",
      name: "Beta",
      mode: "white_label",
      activeCustomers: 1,
      fundBalanceCredits: 0,
      fundPercent: null,
      chargedCredits: 1_000,
      costCredits: 2_500,
    },
  ]);
  platform.partners.create.mockReset().mockResolvedValue({ partnerId: "p9", emailed: true });
  platform.partnerPlan.set.mockReset().mockResolvedValue({ ok: true });
  platform.partnerBranding.get.mockReset().mockResolvedValue({
    brand: null,
    domains: [{ hostname: "app.beta.example.test", state: "active", error: null }],
    sender: { domain: null, state: "none", records: [], error: null },
    customers: 1,
  });
  platform.waitlist.list.mockReset().mockResolvedValue([
    {
      id: "w1",
      email: "ana@example.test",
      company: "Ana Co",
      task: "Scheduling",
      locale: "pt-BR",
      status: "pending",
      createdAt: "2026-11-02T10:00:00.000Z",
    },
    {
      id: "w2",
      email: "old@example.test",
      company: "Old Co",
      task: null,
      locale: null,
      status: "approved",
      createdAt: "2026-10-02T10:00:00.000Z",
    },
  ]);
  platform.waitlist.decide.mockReset().mockResolvedValue({ emailed: true });
  platform.partnerLeads.list.mockReset().mockResolvedValue([
    {
      id: "l1",
      name: "Bia",
      company: "Bia Systems",
      email: "bia@example.test",
      whatsapp: "+55 11 90000-0000",
      website: "https://bia.example.test",
      partnerType: "embedded",
      country: "Brasil",
      customers: "50-200",
      message: "We run salons",
      status: "pending",
      createdAt: "2026-11-03T10:00:00.000Z",
    },
  ]);
  platform.partnerLeads.approve.mockReset().mockResolvedValue({ partnerId: "p8", emailed: true });
  platform.partnerLeads.decline.mockReset().mockResolvedValue({ ok: true });
  platform.invoices.list.mockReset().mockResolvedValue([
    {
      id: "i1",
      partner: "alpha",
      period: "2026-11",
      currency: "BRL",
      state: "draft",
      totalMinor: 12_345,
      lines: 3,
      dueAt: null,
      externalRef: null,
    },
  ]);
  platform.invoices.setState.mockReset().mockResolvedValue({ ok: true });
  platform.limits.get
    .mockReset()
    .mockResolvedValue({ override: { computers: 3 }, plan: "personal" });
  platform.limits.set.mockReset().mockResolvedValue({ ok: true });
});

it("sends anyone who is not an operator home without asking the platform for anything", async () => {
  operator.value = false;
  await open("/app/platform/pricing");
  expect(container.textContent).toBe("home");
  expect(platform.partnerPricing.get).not.toHaveBeenCalled();
});

it("opens on the pricing and publishes the next version with what was edited", async () => {
  await open("/app/platform");
  expect(container.textContent).toContain("Version 3 live since");
  expect(container.textContent).toContain("Customer-owned models are never charged");
  const publish = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Publish version 4"),
  ) as HTMLButtonElement;
  expect(publish.disabled).toBe(true);

  await act(async () => change(field("Voice Margin (%)"), "45"));
  expect(publish.disabled).toBe(false);
  await act(async () => publish.click());
  const confirm = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent === "Publish",
  ) as HTMLButtonElement;
  await act(async () => confirm.click());

  const [{ config: sent }] = platform.partnerPricing.publish.mock.calls[0] as [
    { config: typeof config },
  ];
  expect(sent.margins.voiceBps).toBe(4500);
  expect(sent.margins.tokensBps).toBe(3000);
  expect(sent.tiers[0]?.prices.BRL).toEqual({ priceMinor: 100_000, includedCredits: 20_000 });
});

it("does not let a half-typed number be published", async () => {
  await open("/app/platform/pricing");
  await act(async () => change(field("Voice Margin (%)"), "4x"));
  const publish = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Publish version"),
  ) as HTMLButtonElement;
  expect(publish.disabled).toBe(true);
  expect(container.textContent).toContain("Check the numbers");
});

it("simulates live, once typing settles, against the draft being edited", async () => {
  await open("/app/platform/pricing");
  await act(async () => change(field("Voice Margin (%)"), "50"));
  vi.useFakeTimers();
  try {
    container.querySelector<HTMLAnchorElement>('a[href="/app/platform/simulator"]')?.click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(container.textContent).toContain("Draft");
    const inputs = platform.partnerPricing.simulate.mock.calls.map(
      ([input]) => input as { config?: typeof config; customers: number },
    );
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    expect(inputs.every((input) => input.config?.margins.voiceBps === 5000)).toBe(true);

    platform.partnerPricing.simulate.mockClear();
    await act(async () => change(field("Customers"), "25"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(platform.partnerPricing.simulate).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(platform.partnerPricing.simulate).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const [first] = platform.partnerPricing.simulate.mock.calls as Array<[{ customers: number }]>;
    expect(first?.[0].customers).toBe(25);
    expect(container.textContent).toContain("250");
    expect(container.textContent).toContain("80");
  } finally {
    vi.useRealTimers();
  }
});

it("shows each partner's month and marks a negative margin", async () => {
  await open("/app/platform/partners");
  const alpha = container.querySelector('[data-testid="platform-partner-alpha"]');
  const beta = container.querySelector('[data-testid="platform-partner-beta"]');
  expect(alpha?.textContent).toContain("Embedded");
  expect(alpha?.querySelector("[data-negative]")).toBeNull();
  expect(beta?.textContent).toContain("White label");
  expect(beta?.querySelector("[data-negative]")?.textContent).toBe("-$15.00");
});

it("reads a white label partner's host and its state, and asks nothing for the others", async () => {
  await open("/app/platform/partners");
  expect(container.querySelector('[data-testid="platform-domain-p2"]')?.textContent).toBe(
    "app.beta.example.test · Active",
  );
  expect(platform.partnerBranding.get).toHaveBeenCalledTimes(1);
  expect(platform.partnerBranding.get).toHaveBeenCalledWith({ partnerId: "p2" }, expect.anything());
});

it("moves an invoice to the next state, with its document number", async () => {
  await open("/app/platform/invoices");
  expect(container.textContent).toContain("R$");
  await act(async () => change(field("Document number"), "NF-9"));
  const issue = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Issue",
  ) as HTMLButtonElement;
  await act(async () => issue.click());
  expect(platform.invoices.setState).toHaveBeenCalledWith(
    { id: "i1", state: "issued", externalRef: "NF-9" },
    expect.anything(),
  );
});

it("reads and saves one organization's limits, leaving blanks to the plan", async () => {
  await open("/app/platform/limits");
  await act(async () => change(field("Organization ID"), "org-1"));
  await act(async () => {
    container.querySelector("form")?.requestSubmit();
  });
  await settle();
  expect(field("Computers").value).toBe("3");
  await act(async () => change(field("Seats"), "5"));
  const save = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Save",
  ) as HTMLButtonElement;
  await act(async () => save.click());
  expect(platform.limits.set).toHaveBeenCalledWith(
    { organizationId: "org-1", override: { computers: 3, maxSeats: 5 } },
    expect.anything(),
  );
});

const button = (label: string, root: ParentNode = container) =>
  [...root.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  ) as HTMLButtonElement;

it("approves a waitlist entry and leaves decided ones alone", async () => {
  await open("/app/platform/waitlist");
  expect(container.textContent).toContain("Ana Co");
  expect(container.textContent).toContain("Approved");
  expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  await act(async () => button("Approve").click());
  expect(platform.waitlist.decide).toHaveBeenCalledWith(
    { id: "w1", decision: "approved" },
    expect.anything(),
  );
  expect(
    [...container.querySelectorAll("button")].filter((b) => b.textContent === "Approve"),
  ).toHaveLength(1);
});

it("turns an application into a partner with the operator's choices", async () => {
  await open("/app/platform/applications");
  expect(container.textContent).toContain("Bia Systems");
  expect(container.textContent).toContain("We run salons");
  await act(async () => button("Approve").click());
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog.textContent).toContain("bia@example.test");
  expect((dialog.querySelector('input[aria-label="Slug"]') as HTMLInputElement).value).toBe(
    "bia-systems",
  );
  expect((dialog.querySelector('input[aria-label="Country"]') as HTMLInputElement).value).toBe(
    "BR",
  );
  await act(async () => button("Approve", dialog).click());
  expect(platform.partnerLeads.approve).toHaveBeenCalledWith(
    {
      id: "l1",
      partner: {
        name: "Bia Systems",
        slug: "bia-systems",
        mode: "embedded",
        country: "BR",
        planKey: "starter",
      },
    },
    expect.anything(),
  );
});

it("declines an application with a short reason", async () => {
  await open("/app/platform/applications");
  await act(async () => button("Decline").click());
  const dialog = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
  await act(async () => change(dialog.querySelector("input") as HTMLInputElement, "Not a fit"));
  await act(async () => button("Decline", dialog).click());
  expect(platform.partnerLeads.decline).toHaveBeenCalledWith(
    { id: "l1", reason: "Not a fit" },
    expect.anything(),
  );
});

it("makes a partner from Partners, with its owner, and needs a valid form", async () => {
  await open("/app/platform/partners");
  await act(async () => button("New partner").click());
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  const create = button("Create", dialog);
  expect(create.disabled).toBe(true);
  await act(async () =>
    change(
      dialog.querySelector('input[aria-label="Product name"]') as HTMLInputElement,
      "Green Barber",
    ),
  );
  await act(async () =>
    change(dialog.querySelector('input[aria-label="Country"]') as HTMLInputElement, "us"),
  );
  await act(async () =>
    change(
      dialog.querySelector('input[aria-label="Owner email"]') as HTMLInputElement,
      "owner@example.test",
    ),
  );
  expect(create.disabled).toBe(false);
  await act(async () => create.click());
  expect(platform.partners.create).toHaveBeenCalledWith(
    {
      name: "Green Barber",
      slug: "green-barber",
      mode: "embedded",
      country: "US",
      planKey: "starter",
      ownerEmail: "owner@example.test",
    },
    expect.anything(),
  );
});

it("lists the versions and publishes one from a later day", async () => {
  await open("/app/platform/pricing");
  const history = container.querySelector('[data-testid="platform-pricing-history"]');
  expect(history?.textContent).toContain("Scheduled");
  expect(history?.textContent).toContain("Live");
  await act(async () => change(field("Voice Margin (%)"), "45"));
  const publish = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith("Publish version"),
  ) as HTMLButtonElement;
  await act(async () => publish.click());
  const day = document.body.querySelector('input[type="date"]') as HTMLInputElement;
  expect(document.body.textContent).toContain("right away");
  await act(async () => change(day, "2999-02-01"));
  expect(document.body.textContent).toContain("from the chosen day");
  const confirm = [...document.body.querySelectorAll("button")].find(
    (item) => item.textContent === "Publish",
  ) as HTMLButtonElement;
  await act(async () => confirm.click());
  const [sent] = platform.partnerPricing.publish.mock.calls[0] as [{ effectiveOn?: string }];
  expect(sent.effectiveOn).toBe("2999-02-01");
});

it("puts an embedded partner on a plan from the Partners table", async () => {
  await open("/app/platform/partners");
  const select = container.querySelector('select[aria-label="Alpha Plan"]') as HTMLSelectElement;
  expect(container.querySelector('select[aria-label="Beta Plan"]')).toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, "starter");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(platform.partnerPlan.set).toHaveBeenCalledWith(
    { partnerId: "p1", tierKey: "starter" },
    expect.anything(),
  );
});
