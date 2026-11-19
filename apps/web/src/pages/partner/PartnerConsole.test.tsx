// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  partners: vi.fn(),
  overview: vi.fn(),
  customers: vi.fn(),
  customer: vi.fn(),
  customerAction: vi.fn(),
  supportSession: vi.fn(),
  pricing: vi.fn(),
  setPricing: vi.fn(),
  integration: vi.fn(),
  rotateKey: vi.fn(),
  setAlertEmail: vi.fn(),
  template: vi.fn(),
  setTemplate: vi.fn(),
  branding: vi.fn(),
  setBrand: vi.fn(),
  addDomain: vi.fn(),
  checkDomain: vi.fn(),
  removeDomain: vi.fn(),
  setSenderDomain: vi.fn(),
  checkSenderDomain: vi.fn(),
  payments: vi.fn(),
  connect: vi.fn(),
  connectDashboard: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { partnerConsole: api } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, ""),
}));

import { formatMoney } from "../../lib/partner-console";
import { SidebarPartnership } from "../shell/sidebar-partner";
import { PartnerConsolePage } from "./PartnerConsolePage";

const embedded = {
  id: "p1",
  slug: "greenbarber",
  name: "GreenBarber",
  mode: "embedded" as const,
  currency: "BRL" as const,
  accent: null,
  chiefName: null,
};
const whiteLabel = { ...embedded, id: "p2", name: "Other", mode: "white_label" as const };

let root: Root;
let container: HTMLElement;

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
}

async function render(path: string, ui: ReactNode = <PartnerConsolePage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/partner/:partnerId?/:section?" element={ui} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
}

const byText = (text: string, tag = "button") =>
  [...document.body.querySelectorAll<HTMLElement>(tag)].find(
    (el) => el.textContent?.trim() === text,
  );

async function click(el: HTMLElement | undefined) {
  expect(el).toBeTruthy();
  await act(async () => el?.click());
  await settle();
}

function setValue(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(api)) fn.mockReset();
  api.partners.mockResolvedValue([embedded]);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  container.remove();
});

describe("partner console", () => {
  it("opens the overview with its figures and what needs the partner", async () => {
    api.overview.mockResolvedValue({
      currency: "BRL",
      revenue: { total: 784_000, commission: 139_200, markup: 644_800 },
      activeCustomers: 48,
      newCustomers: 3,
      creditLow: 5,
      pastDue: 2,
      monthly: [
        { month: "2026-10", total: 500_000 },
        { month: "2026-11", total: 784_000 },
      ],
      attention: [
        {
          kind: "credit_low",
          tenantId: "t1",
          tenantName: "Barbearia Lima",
          detail: "92%",
          at: "x",
        },
      ],
    });
    await render("/app/partner/p1/overview");
    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("48");
    expect(container.textContent).toContain("Barbearia Lima · credit at 92%");
    expect(container.querySelectorAll('[data-testid="partner-bars"] > div')).toHaveLength(2);
  });

  it("shows a failed load with a way to try again", async () => {
    api.overview.mockRejectedValue(new Error("Boom"));
    await render("/app/partner/p1/overview");
    expect(container.querySelector('[data-testid="partner-error"]')).toBeTruthy();
    api.overview.mockClear();
    await click(byText("Try again"));
    expect(api.overview).toHaveBeenCalledTimes(1);
  });

  it("sends a section the partner does not have back to its overview", async () => {
    api.overview.mockResolvedValue({
      currency: "BRL",
      revenue: { total: 0, commission: 0, markup: 0 },
      activeCustomers: 0,
      newCustomers: 0,
      creditLow: 0,
      pastDue: 0,
      monthly: [],
      attention: [],
    });
    await render("/app/partner/p1/pricing");
    expect(api.overview).toHaveBeenCalled();
  });

  it("previews the customer price live and saves every markup", async () => {
    api.partners.mockResolvedValue([whiteLabel]);
    const item = {
      itemId: "plan:team",
      planId: "team",
      name: "Team",
      creditMinor: 5_000,
      baseMinor: 10_000,
      commissionMinor: 2_000,
      markup: { kind: "fixed" as const, value: 0 },
      markupMinor: 0,
      finalMinor: 10_000,
    };
    api.pricing.mockResolvedValue({
      currency: "BRL",
      commissionBps: 2_000,
      checkoutUrl: null,
      plans: [item],
      packs: [],
    });
    api.setPricing.mockResolvedValue({
      currency: "BRL",
      commissionBps: 2_000,
      checkoutUrl: null,
      plans: [{ ...item, markup: { kind: "percent", value: 2_500 }, finalMinor: 12_500 }],
      packs: [],
    });
    await render("/app/partner/p2/pricing");
    const save = byText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label^="Markup type"]');
    await act(async () => {
      if (select) {
        select.value = "percent";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    setValue(container.querySelector('input[aria-label^="Markup for"]'), "25");
    expect(container.textContent).toContain(formatMoney(12_500, "BRL", "en"));
    await click(byText("Save"));
    expect(api.setPricing).toHaveBeenCalledWith({
      partnerId: "p2",
      checkoutUrl: null,
      markups: [{ itemId: "plan:team", kind: "percent", value: 2_500 }],
    });
  });

  it("repeats the same key when a failed credit is retried, and a new one for a new amount", async () => {
    api.customers.mockResolvedValue({
      items: [
        {
          tenantId: "t1",
          name: "Barbearia Lima",
          plan: "Team",
          creditUsedPct: 92,
          creditRemaining: 900,
          state: "active",
          since: "2026-03-01",
        },
      ],
      next: null,
    });
    api.customer.mockResolvedValue({
      tenantId: "t1",
      name: "Barbearia Lima",
      plan: "Team",
      creditUsedPct: 92,
      creditRemaining: 900,
      state: "active",
      since: "2026-03-01",
      agents: ["Reception"],
      connector: "ok",
      runs30d: 412,
      balance: {
        currency: "BRL",
        remaining: 900,
        planRemaining: 900,
        topupRemaining: 0,
        periodEnd: null,
      },
      priceMinor: 12_000,
    });
    api.customerAction.mockRejectedValueOnce(new Error("Network")).mockResolvedValue({
      state: "active",
      creditRemaining: 1_900,
      replayed: false,
    });
    await render("/app/partner/p1/customers?customer=t1");
    setValue(document.body.querySelector('input[aria-label="Amount"]'), "10");
    await click(byText("Add credit"));
    await click(byText("Add credit"));
    setValue(document.body.querySelector('input[aria-label="Amount"]'), "20");
    await click(byText("Add credit"));
    const calls = api.customerAction.mock.calls.map(([input]) => input);
    expect(calls).toHaveLength(3);
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
    expect(calls[2].idempotencyKey).not.toBe(calls[0].idempotencyKey);
    expect(calls[0]).toMatchObject({ action: "add_credit", amountMinor: 1_000 });
  });

  it("asks twice before pausing a customer", async () => {
    api.customers.mockResolvedValue({ items: [], next: null });
    api.customer.mockResolvedValue({
      tenantId: "t1",
      name: "Barbearia Lima",
      plan: null,
      creditUsedPct: null,
      creditRemaining: 0,
      state: "active",
      since: "2026-03-01",
      agents: [],
      connector: "none",
      runs30d: 0,
      balance: {
        currency: "BRL",
        remaining: 0,
        planRemaining: 0,
        topupRemaining: 0,
        periodEnd: null,
      },
      priceMinor: null,
    });
    api.customerAction.mockResolvedValue({ state: "paused", creditRemaining: 0, replayed: false });
    await render("/app/partner/p1/customers?customer=t1");
    await click(byText("Pause"));
    expect(api.customerAction).not.toHaveBeenCalled();
    await click(byText("Pause customer?"));
    expect(api.customerAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pause", tenantId: "t1" }),
    );
  });

  it("switches the email for one kind of alert, leaving the others on", async () => {
    api.integration.mockResolvedValue({
      keys: [],
      webhook: { url: null, enabled: false },
      alerts: [
        { kind: "partner.balance_low", email: true },
        { kind: "invoice.issued", email: true },
      ],
      docsUrl: "https://example.test/docs",
    });
    api.setAlertEmail.mockResolvedValue({ ok: true });
    await render("/app/partner/p1/integration");
    const toggle = container.querySelector<HTMLElement>('[aria-label="Credit fund running low"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await click(toggle ?? undefined);
    expect(api.setAlertEmail).toHaveBeenCalledWith({
      partnerId: "p1",
      kind: "partner.balance_low",
      email: false,
    });
  });

  it("shows a replaced key once, after asking", async () => {
    api.integration.mockResolvedValue({
      keys: [{ prefix: "pk_live_ab", createdAt: "2026-01-01" }],
      webhook: { url: null, enabled: false },
      alerts: [],
      docsUrl: "https://example.test/docs",
    });
    api.rotateKey.mockResolvedValue({ key: "pk_live_secret_value", prefix: "pk_live_cd" });
    await render("/app/partner/p1/integration");
    await click(byText("New key"));
    expect(api.rotateKey).not.toHaveBeenCalled();
    await click(byText("Replace key? The old one stops working."));
    expect(api.rotateKey).toHaveBeenCalledWith({ partnerId: "p1" });
    expect(container.querySelector('[data-testid="partner-new-key"]')?.textContent).toBe(
      "pk_live_secret_value",
    );
  });
});

describe("partner template", () => {
  it("shows the template and saves an edited one through the console", async () => {
    const template = {
      agents: [
        { key: "reception", name: "Reception", instructions: "Greet.", usesConnector: false },
      ],
      chiefName: "Ana",
    };
    api.template.mockResolvedValue({ template });
    api.setTemplate.mockResolvedValue({ template });
    await render("/app/partner/p1/template");
    expect(container.textContent).toContain("Agent model");
    expect(container.textContent).toContain("Reception");
    expect(container.textContent).toContain("Ana");
    await click(byText("Edit"));
    await click(byText("Save"));
    expect(api.setTemplate).toHaveBeenCalledWith({
      partnerId: "p1",
      template: expect.objectContaining({ chiefName: "Ana" }),
    });
  });
});

describe("partner sidebar section", () => {
  const sidebar = <SidebarPartnership onOpen={() => {}} />;

  it("is absent for a member the console refuses", async () => {
    api.partners.mockRejectedValue(new Error("FORBIDDEN"));
    await render("/app/partner", sidebar);
    expect(container.querySelector('[data-testid="sidebar-partnership"]')).toBeNull();
  });

  it("is absent when the organization runs no partner", async () => {
    api.partners.mockResolvedValue([]);
    await render("/app/partner", sidebar);
    expect(container.querySelector('[data-testid="sidebar-partnership"]')).toBeNull();
  });

  it("lists the screens of an embedded partner and has no switcher for one product", async () => {
    await render("/app/partner", sidebar);
    expect(container.querySelector('[data-testid="sidebar-partner-credits"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="sidebar-partner-invoices"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="sidebar-partner-pricing"]')).toBeNull();
    expect(container.querySelector("select")).toBeNull();
  });

  it("offers a product switcher when there are several partners", async () => {
    api.partners.mockResolvedValue([embedded, whiteLabel]);
    await render("/app/partner/p2/overview", sidebar);
    const select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("p2");
    expect(container.querySelector('[data-testid="sidebar-partner-pricing"]')).toBeTruthy();
  });
});

const emptySender = { domain: null, state: "none" as const, records: [], error: null };
const brandSaved = {
  appName: "Acme",
  accent: "#2563eb",
  supportEmail: null,
  termsUrl: null,
  privacyUrl: null,
  logoUrl: null,
  iconUrl: null,
};

describe("partner brand and domain", () => {
  beforeEach(() => api.partners.mockResolvedValue([whiteLabel]));

  it("offers Brand and Domain to white label partners only", async () => {
    await render("/app/partner/p2/overview", <SidebarPartnership onOpen={() => undefined} />);
    expect(document.querySelector("[data-testid=sidebar-partner-brand]")).toBeTruthy();
    expect(document.querySelector("[data-testid=sidebar-partner-domain]")).toBeTruthy();
    api.partners.mockResolvedValue([embedded]);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render("/app/partner/p1/overview", <SidebarPartnership onOpen={() => undefined} />);
    expect(document.querySelector("[data-testid=sidebar-partner-brand]")).toBeNull();
  });

  it("previews the brand as it is typed and refuses an accent without contrast", async () => {
    api.branding.mockResolvedValue({
      brand: brandSaved,
      domainsAvailable: true,
      domain: null,
      senderAvailable: false,
      sender: emptySender,
    });
    await render("/app/partner/p2/brand");
    const preview = document.querySelector("[data-testid=brand-preview]");
    expect(preview?.textContent).toContain("Acme");
    setValue(document.querySelector<HTMLInputElement>("#brand-name"), "Acme Pro");
    expect(preview?.textContent).toContain("Acme Pro");
    const save = byText("Save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    // Near white: unreadable on the light page.
    setValue(document.querySelector<HTMLInputElement>("#brand-accent"), "#f5f5f0");
    expect(document.body.textContent).toContain("Not enough contrast on both light and dark.");
    expect((byText("Save") as HTMLButtonElement).disabled).toBe(true);
    setValue(document.querySelector<HTMLInputElement>("#brand-accent"), "#2563eb");
    expect((byText("Save") as HTMLButtonElement).disabled).toBe(false);
    api.setBrand.mockResolvedValue({
      brand: { ...brandSaved, appName: "Acme Pro" },
      domainsAvailable: true,
      domain: null,
      senderAvailable: false,
      sender: emptySender,
    });
    await click(byText("Save"));
    expect(api.setBrand).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: "p2", appName: "Acme Pro", accent: "#2563eb" }),
    );
  });

  it("shows the exact CNAME and the one next step, then the legal links step", async () => {
    api.branding.mockResolvedValue({
      brand: brandSaved,
      domainsAvailable: true,
      domain: {
        hostname: "app.acme.example.test",
        state: "pending",
        cname: { name: "app.acme.example.test", target: "fallback.rook.example" },
        nextStep: "add_cname",
        error: null,
      },
      senderAvailable: false,
      sender: emptySender,
    });
    await render("/app/partner/p2/domain");
    const panel = document.querySelector("[data-testid=domain-panel]");
    expect(panel?.textContent).toContain("app.acme.example.test");
    expect(panel?.textContent).toContain("CNAME");
    expect(panel?.textContent).toContain("fallback.rook.example");
    expect(panel?.textContent).toContain("Add this record at your DNS provider.");
    expect(document.querySelector("[data-testid=domain-state]")?.getAttribute("data-state")).toBe(
      "pending",
    );
  });

  it("adds a hostname and shows the sender domain records", async () => {
    api.branding.mockResolvedValue({
      brand: brandSaved,
      domainsAvailable: true,
      domain: null,
      senderAvailable: true,
      sender: {
        domain: "mail.acme.example.test",
        state: "pending",
        records: [
          { type: "TXT", name: "send.mail.acme.example.test", value: "v=spf1", status: "pending" },
        ],
        error: null,
      },
    });
    await render("/app/partner/p2/domain");
    expect(document.querySelector("[data-testid=sender-panel]")?.textContent).toContain("v=spf1");
    setValue(
      document.querySelector<HTMLInputElement>('input[aria-label="Domain"]'),
      "app.acme.example.test",
    );
    api.addDomain.mockResolvedValue({
      brand: brandSaved,
      domainsAvailable: true,
      domain: {
        hostname: "app.acme.example.test",
        state: "pending",
        cname: { name: "app.acme.example.test", target: "fallback.rook.example" },
        nextStep: "add_cname",
        error: null,
      },
      senderAvailable: true,
      sender: emptySender,
    });
    await click(byText("Add"));
    expect(api.addDomain).toHaveBeenCalledWith({
      partnerId: "p2",
      hostname: "app.acme.example.test",
    });
    expect(document.querySelector("[data-testid=domain-panel]")).toBeTruthy();
describe("receipts of a white label partner", () => {
  const payments = (over: object = {}) => ({
    state: "none",
    accountHint: null,
    requirementsDue: [],
    available: true,
    payouts: [],
    disputes: [],
    ...over,
  });

  it("connects an account that does not exist yet and goes to onboarding", async () => {
    api.partners.mockResolvedValue([whiteLabel]);
    api.payments.mockResolvedValue(payments());
    api.connect.mockResolvedValue({ url: "https://connect.example.test/setup" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    await render("/app/partner/p2/payments");
    expect(container.querySelector('[data-testid="partner-connect-state"]')?.textContent).toBe(
      "Not connected",
    );
    expect(byText("Open dashboard")).toBeUndefined();
    await click(byText("Connect account"));
    expect(api.connect).toHaveBeenCalledWith({ partnerId: "p2" });
    expect(assign).toHaveBeenCalledWith("https://connect.example.test/setup");
  });

  it("shows an active account with its payouts and offers the dashboard, not onboarding", async () => {
    api.partners.mockResolvedValue([whiteLabel]);
    api.payments.mockResolvedValue(
      payments({
        state: "active",
        accountHint: "Ab12Cd",
        payouts: [
          {
            id: "po1",
            amountMinor: 50_000,
            currency: "BRL",
            status: "paid",
            arrivedAt: "2026-11-12T00:00:00.000Z",
            createdAt: "2026-11-10T00:00:00.000Z",
          },
        ],
        disputes: [
          {
            id: "dp1",
            amountMinor: 13_000,
            currency: "BRL",
            reason: "fraudulent",
            status: "needs_response",
            createdAt: "2026-11-11T00:00:00.000Z",
          },
        ],
      }),
    );
    await render("/app/partner/p2/payments");
    expect(container.querySelector('[data-testid="partner-connect-state"]')?.textContent).toBe(
      "Active",
    );
    expect(container.textContent).toContain(formatMoney(50_000, "BRL", "en"));
    expect(container.querySelector('[data-testid="partner-disputes"]')?.textContent).toContain(
      "Needs response",
    );
    expect(byText("Open dashboard")).toBeTruthy();
    expect(byText("Connect account")).toBeUndefined();
    expect(byText("Continue setup")).toBeUndefined();
  });

  it("asks the partner to continue when the provider needs more", async () => {
    api.partners.mockResolvedValue([whiteLabel]);
    api.payments.mockResolvedValue(payments({ state: "restricted", requirementsDue: ["x"] }));
    await render("/app/partner/p2/payments");
    expect(byText("Continue setup")).toBeTruthy();
    expect(container.textContent).toContain("More information needed");
  });

  it("says when payments are off, and starts nothing", async () => {
    api.partners.mockResolvedValue([whiteLabel]);
    api.payments.mockResolvedValue(payments({ available: false }));
    await render("/app/partner/p2/payments");
    expect(container.querySelector('[data-testid="partner-connect-state"]')?.textContent).toBe(
      "Unavailable",
    );
    expect(byText("Connect account")).toBeUndefined();
  });

  it("is not a screen of an embedded partner", async () => {
    api.partners.mockResolvedValue([embedded]);
    api.overview.mockResolvedValue({
      currency: "BRL",
      revenue: { total: 0, commission: 0, markup: 0 },
      activeCustomers: 0,
      newCustomers: 0,
      creditLow: 0,
      pastDue: 0,
      monthly: [],
      attention: [],
    });
    await render("/app/partner/p1/payments");
    expect(api.payments).not.toHaveBeenCalled();
  });
});
