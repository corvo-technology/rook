import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const partner = {
  id: "partner-1",
  slug: "acme",
  name: "Acme",
  mode: "embedded",
  currency: "BRL",
  accent: null,
  chiefName: null,
};

const customer = {
  tenantId: "tenant-1",
  name: "Barbearia Lima",
  plan: "Team",
  creditUsedPct: 92,
  creditRemaining: 900,
  state: "active",
  since: "2026-03-01T00:00:00.000Z",
};

const answers: Record<string, unknown> = {
  partners: [partner],
  overview: {
    currency: "BRL",
    revenue: { total: 784_000, commission: 139_200, markup: 644_800 },
    activeCustomers: 48,
    newCustomers: 3,
    creditLow: 5,
    pastDue: 2,
    monthly: [
      { month: "2026-06", total: 410_000 },
      { month: "2026-07", total: 460_000 },
      { month: "2026-08", total: 520_000 },
      { month: "2026-09", total: 610_000 },
      { month: "2026-10", total: 700_000 },
      { month: "2026-11", total: 784_000 },
    ],
    attention: [
      {
        kind: "credit_low",
        tenantId: "tenant-1",
        tenantName: "Barbearia Lima",
        detail: "92%",
        at: "x",
      },
      { kind: "past_due", tenantId: "tenant-2", tenantName: "Studio Corte", detail: "4", at: "x" },
    ],
  },
  integration: {
    keys: [{ prefix: "cpk_acme", createdAt: "2026-03-01T00:00:00.000Z" }],
    webhook: { url: null, enabled: false },
    alerts: [
      { kind: "customer.credit_limit_reached", email: true },
      { kind: "partner.balance_low", email: true },
      { kind: "partner.autotopup_started", email: false },
      { kind: "partner.autotopup_failed", email: true },
      { kind: "invoice.issued", email: true },
      { kind: "subscription.lapsed", email: true },
      { kind: "customer.connector_down", email: true },
    ],
    docsUrl: "https://example.test/docs",
  },
  customers: { items: [customer], next: null },
  customer: {
    ...customer,
    agents: ["Reception", "Follow-up"],
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
  },
};

test("The partner area lists the customers and opens one", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `partner-console-${stamp}@corvo.test`, "password12", `Partner ${stamp}`);
  await completeOnboarding(page);
  await page.route("**/rpc/partnerConsole/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({ json: { json: answers[name] ?? null } });
  });

  await page.goto("/app/home");
  const nav = page.getByTestId("sidebar-partnership");
  await expect(nav).toBeVisible();
  await expect(nav.getByTestId("sidebar-partner-credits")).toBeVisible();
  await expect(nav.getByTestId("sidebar-partner-pricing")).toHaveCount(0);

  await nav.getByTestId("sidebar-partner-overview").click();
  const overview = page.getByTestId("partner-overview");
  await expect(overview.getByText("Barbearia Lima · credit at 92%")).toBeVisible();
  await captureScreenshot(page, testInfo, "partner-overview");

  await nav.getByTestId("sidebar-partner-customers").click();
  await page.getByRole("button", { name: "Barbearia Lima" }).click();
  const panel = page.getByTestId("partner-customer-panel");
  await expect(panel.getByRole("button", { name: "Open as support" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Pause" })).toBeVisible();
  await captureScreenshot(page, testInfo, "partner-customers");

  await nav.getByTestId("sidebar-partner-integration").click();
  const alerts = page.getByTestId("partner-alerts");
  await expect(alerts.getByRole("switch", { name: "Credit fund running low" })).toBeChecked();
  await expect(alerts.getByRole("switch", { name: "Automatic top-up started" })).not.toBeChecked();
  await captureScreenshot(page, testInfo, "partner-alerts");
});

test("A white label partner sees its receipts and connects an account", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `partner-payments-${stamp}@corvo.test`, "password12", `Partner ${stamp}`);
  await completeOnboarding(page);
  const whiteLabel = {
    ...partner,
    id: "partner-2",
    slug: "agency",
    name: "Agency",
    mode: "white_label",
  };
  const payments = {
    state: "active",
    accountHint: "Ab12Cd",
    requirementsDue: [],
    available: true,
    payouts: [
      {
        id: "payout-1",
        amountMinor: 50_000,
        currency: "BRL",
        status: "paid",
        arrivedAt: "2026-11-12T00:00:00.000Z",
        createdAt: "2026-11-10T00:00:00.000Z",
      },
      {
        id: "payout-2",
        amountMinor: 32_000,
        currency: "BRL",
        status: "paid",
        arrivedAt: "2026-11-05T00:00:00.000Z",
        createdAt: "2026-11-03T00:00:00.000Z",
      },
    ],
    disputes: [
      {
        id: "dispute-1",
        amountMinor: 13_000,
        currency: "BRL",
        reason: "fraudulent",
        status: "needs_response",
        createdAt: "2026-11-11T00:00:00.000Z",
      },
    ],
  };
  const whiteLabelAnswers: Record<string, unknown> = { partners: [whiteLabel], payments };
  await page.route("**/rpc/partnerConsole/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({ json: { json: whiteLabelAnswers[name] ?? null } });
  });

  await page.goto("/app/home");
  const nav = page.getByTestId("sidebar-partnership");
  await expect(nav.getByTestId("sidebar-partner-payments")).toBeVisible();
  await nav.getByTestId("sidebar-partner-payments").click();
  const receipts = page.getByTestId("partner-payments");
  await expect(receipts.getByTestId("partner-connect-state")).toHaveText("Active");
  await expect(receipts.getByRole("button", { name: "Open dashboard" })).toBeVisible();
  await expect(receipts.getByRole("button", { name: "Connect account" })).toHaveCount(0);
  await expect(receipts.getByTestId("partner-disputes")).toContainText("Needs response");
  await captureScreenshot(page, testInfo, "partner-payments");
});
