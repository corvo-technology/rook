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
});
