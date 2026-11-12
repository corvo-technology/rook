import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

const price = { amount: 1200, currency: "usd", interval: "month", intervalCount: 1 };

function billingStatus(overrides: Record<string, unknown>) {
  return {
    access: false,
    canManage: true,
    trialAvailable: false,
    trialDays: 0,
    state: "none",
    price,
    seats: 1,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    hasCustomer: false,
    ...overrides,
  };
}

async function enableBilling(route: Route, path: "me" | "bootstrap") {
  const response = await route.fetch();
  const body = (await response.json()) as { json?: Record<string, unknown> };
  const me = path === "me" ? body.json : (body.json?.me as Record<string, unknown> | undefined);
  if (me) me.billingEnabled = true;
  await route.fulfill({ response, json: body });
}

test("billing paywall holds the app until the subscription is active", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `billing-${stamp}@corvo.test`, "password12", `Billing ${stamp}`);
  await completeOnboarding(page);

  await page.route("**/api/auth/capabilities", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), billing: true } });
  });
  await page.route("**/rpc/me", (route) => enableBilling(route, "me"));
  await page.route("**/rpc/bootstrap", (route) => enableBilling(route, "bootstrap"));
  let status = billingStatus({});
  await page.route("**/rpc/billing/status", (route) => route.fulfill({ json: { json: status } }));
  await page.reload();

  const paywall = page.getByTestId("billing-paywall");
  await expect(paywall.getByRole("button", { name: "Subscribe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "$12 / month" })).toBeVisible();
  await expect(paywall.getByRole("button", { name: "Log out" })).toBeVisible();
  await captureScreenshot(page, testInfo, "billing-paywall");

  // An unpaid subscription resumes in the portal rather than starting a second checkout.
  status = billingStatus({ state: "unpaid", hasCustomer: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(paywall.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await expect(paywall.getByRole("button", { name: "Subscribe" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "billing-paywall-unpaid");

  status = billingStatus({
    access: true,
    state: "active",
    seats: 3,
    currentPeriodEndsAt: "2030-01-15T12:00:00.000Z",
    hasCustomer: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Chief").first()).toBeVisible();

  const settings = await openUserSettings(page, "billing");
  await expect(settings).toHaveAttribute("data-settings-section", "billing");
  const billing = settings.getByTestId("billing-settings");
  await expect(billing.getByRole("heading", { name: "Active", exact: true })).toBeVisible();
  await expect(billing.getByText(/\$12 \/ month\s*3 seats/)).toBeVisible();
  await expect(billing.getByText(/^Renews /)).toBeVisible();
  await expect(billing.getByRole("button", { name: "Manage" })).toBeVisible();
  await captureScreenshot(page, testInfo, "settings-billing");
});

test("choose your own key or monthly credits, then add a one-time top-up", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `credit-choice-${stamp}@corvo.test`, "password12", "Demo Customer");
  await completeOnboarding(page);
  await page.route("**/api/auth/capabilities", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), billing: true } });
  });
  await page.route("**/rpc/me", (route) => enableBilling(route, "me"));
  await page.route("**/rpc/bootstrap", (route) => enableBilling(route, "bootstrap"));
  let status = billingStatus({
    creditPurchasesEnabled: true,
    byokPriceCents: 1000,
    funding: null,
    balanceUsd: 0,
    monthlyAmountCents: null,
  });
  await page.route("**/rpc/billing/status", (route) => route.fulfill({ json: { json: status } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose how to use Rook" })).toBeVisible();
  // One card: credits are on by default, and the switch turns them off for the own-key plan.
  const useCredits = page.getByRole("switch", { name: "Use Rook credits", exact: true });
  await expect(useCredits).toBeChecked();
  await expect(page.getByText("Works with your ChatGPT or Claude plan.")).toHaveCount(0);
  await expect(page.getByText(/free trial/i)).toHaveCount(0);
  const planSelect = page.getByRole("combobox", { name: "Monthly credits" });
  await expect(planSelect).toHaveCSS("height", "48px");
  await expect(planSelect).toContainText("$20 / month");
  await planSelect.click();
  const options = page.locator('[data-slot="select-content"]');
  await expect
    .poll(async () => {
      const [trigger, menu] = await Promise.all([planSelect.boundingBox(), options.boundingBox()]);
      return trigger && menu ? Math.abs(trigger.width - menu.width) : 999;
    })
    .toBeLessThanOrEqual(2);
  const triggerBox = await planSelect.boundingBox();
  const optionsBox = await options.boundingBox();
  expect(optionsBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
  await captureScreenshot(page, testInfo, "billing-credit-options");
  await page.keyboard.press("Escape");
  await expect(page.getByText("All $20 goes to model usage.", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "billing-credit-choice");
  let purchase: { amountCents: number; monthly: boolean } | undefined;
  await page.route("**/rpc/billing/purchaseCredits", async (route) => {
    purchase = route.request().postDataJSON().json;
    status = billingStatus({
      access: true,
      creditPurchasesEnabled: true,
      funding: "credits",
      balanceUsd: 20,
      monthlyAmountCents: 2000,
      state: "active",
      hasCustomer: true,
      price: { ...price, amount: 2000 },
    });
    await route.fulfill({ json: { json: { url: new URL("/app", page.url()).href } } });
  });
  await page.getByRole("button", { name: "Subscribe to Rook credits", exact: true }).click();
  await expect(page.getByText("Chief").first()).toBeVisible();
  expect(purchase).toEqual({ amountCents: 2000, monthly: true });
  const settings = await openUserSettings(page, "billing");
  await expect(settings.getByText("$20.00", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "billing-credit-balance");
  await settings.getByRole("button", { name: "Add credits", exact: true }).click();
  const dialog = page.getByTestId("credits-purchase");
  await expect(dialog.getByRole("combobox", { name: "Credit amount" })).toHaveCSS("height", "48px");
  await dialog.getByRole("combobox", { name: "Credit amount" }).click();
  await page.getByRole("option", { name: "$50", exact: true }).click();
  await captureScreenshot(page, testInfo, "billing-add-credits");
  await Promise.all([
    page.waitForEvent("load"),
    dialog.getByRole("button", { name: "Continue to checkout" }).click(),
  ]);
  await expect(page.getByText("Chief").first()).toBeVisible();
  expect(purchase).toEqual({ amountCents: 5000, monthly: false });

  status = billingStatus({
    creditPurchasesEnabled: true,
    funding: null,
    balanceUsd: 0,
    monthlyAmountCents: null,
  });
  await page.reload();
  await page.route("**/rpc/billing/selectFunding", async (route) => {
    status = billingStatus({
      access: true,
      creditPurchasesEnabled: true,
      funding: "byok",
      balanceUsd: 0,
      monthlyAmountCents: null,
    });
    await route.fulfill({ json: { json: { ok: true } } });
  });
  await page.getByRole("switch", { name: "Use Rook credits", exact: true }).click();
  await page.getByRole("button", { name: "Connect my own", exact: true }).click();
  await expect(page.getByText("Chief").first()).toBeVisible();

  // Own-key organizations from before the plan was paid see when their free period ends.
  status = billingStatus({
    access: true,
    creditPurchasesEnabled: true,
    byokPriceCents: 1000,
    byokFreeUntil: "2030-01-15T12:00:00.000Z",
    funding: "byok",
    balanceUsd: 0,
    monthlyAmountCents: null,
  });
  await page.reload();
  await expect(page.getByText("Free plan ends Jan 15, 2030", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "sidebar-free-plan-ends");
  await page.getByRole("button", { name: "Upgrade", exact: true }).click();
  const plans = page.getByTestId("plans-page");
  await plans.getByRole("switch", { name: "Use Rook credits", exact: true }).click();
  await expect(plans.getByText("$10 / month", { exact: true })).toBeVisible();
  await expect(
    plans.getByRole("button", { name: "Subscribe with your own AI", exact: true }),
  ).toBeVisible();
  await expect(plans.getByRole("button", { name: "Log out" })).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]plans/);
  await captureScreenshot(page, testInfo, "billing-upgrade-plans");
  await page.keyboard.press("Escape");
  await expect(plans).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]plans/);
  await expect(page.getByText("Chief").first()).toBeVisible();

  // The plan choice has its own link, and Subscribe pays for the plan instead of reopening setup.
  await page.goto("/app?plans");
  // The bare route redirects to the first chat and keeps the link's `plans` param.
  await expect(page).toHaveURL(/\/app\/[^/?]+\?plans$/);
  await expect(plans).toBeVisible();
  await plans.getByRole("switch", { name: "Use Rook credits", exact: true }).click();
  let selectedFunding = false;
  await page.route("**/rpc/billing/selectFunding", async (route) => {
    selectedFunding = true;
    await route.fulfill({ json: { json: { ok: true } } });
  });
  await page.route("**/rpc/billing/checkout", (route) =>
    route.fulfill({ json: { json: { url: new URL("/app?paid", page.url()).href } } }),
  );
  await Promise.all([
    page.waitForURL(/[?&]paid/),
    plans.getByRole("button", { name: "Subscribe with your own AI", exact: true }).click(),
  ]);
  expect(selectedFunding).toBe(false);
  await page.unroute("**/rpc/billing/selectFunding");
  await expect(page.getByText("Chief").first()).toBeVisible();
  const freePlan = await openUserSettings(page, "billing");
  await expect(
    freePlan.getByText("Using your API key. Free plan ends Jan 15, 2030.", { exact: true }),
  ).toBeVisible();
  await expect(
    freePlan.getByRole("button", { name: "Subscribe for $10 / month", exact: true }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "billing-free-plan-ends");
  await page.keyboard.press("Escape");

  status = billingStatus({
    access: true,
    creditPurchasesEnabled: true,
    funding: "byok",
    balanceUsd: 12,
    monthlyAmountCents: null,
  });
  await page.reload();
  const existingCredits = await openUserSettings(page, "billing");
  await page.route("**/rpc/billing/selectFunding", async (route) => {
    expect(route.request().postDataJSON().json).toEqual({ funding: "credits" });
    status = { ...status, funding: "credits" };
    await route.fulfill({ json: { json: { ok: true } } });
  });
  await captureScreenshot(page, testInfo, "billing-use-existing-credits");
  // Switching reloads the page; the URL keeps Billing open to show the result.
  const creditsSwitch = existingCredits.getByRole("switch", {
    name: "Use Rook credits",
    exact: true,
  });
  await expect(creditsSwitch).not.toBeChecked();
  await creditsSwitch.click();
  const reactivated = page.getByTestId("settings-page");
  await expect(reactivated).toHaveAttribute("data-settings-section", "billing");
  await expect(reactivated.getByText("$12.00", { exact: true })).toBeVisible();
  await expect(
    reactivated.getByRole("switch", { name: "Use Rook credits", exact: true }),
  ).toBeChecked();
  expect(purchase).toEqual({ amountCents: 5000, monthly: false });
});
