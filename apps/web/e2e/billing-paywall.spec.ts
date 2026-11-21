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
  await expect(page.getByText("Rook").first()).toBeVisible();

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
  await expect(page.getByText("Rook").first()).toBeVisible();
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
  await expect(page.getByText("Rook").first()).toBeVisible();
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
  await expect(page.getByText("Rook").first()).toBeVisible();

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
  await expect(page.getByText("Rook").first()).toBeVisible();

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
  await expect(page.getByText("Rook").first()).toBeVisible();
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

test("the paywall shows three plans and opens the checkout of the chosen one", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `plans-${stamp}@corvo.test`, "password12", `Plans ${stamp}`);
  await completeOnboarding(page);

  await page.route("**/api/auth/capabilities", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), billing: true } });
  });
  await page.route("**/rpc/me", (route) => enableBilling(route, "me"));
  await page.route("**/rpc/bootstrap", (route) => enableBilling(route, "bootstrap"));
  await page.route("**/rpc/billing/status", (route) =>
    route.fulfill({
      json: { json: billingStatus({ funding: "credits", creditPurchasesEnabled: true }) },
    }),
  );
  const plan = (
    name: string,
    seats: number,
    maxSeats: number,
    size: string,
    computers: number,
    gb: number,
  ) => ({
    plan: name,
    computerSize: size,
    computers,
    storageBytes: gb * 1024 ** 3,
    seatsIncluded: seats,
    maxSeats,
  });
  await page.route("**/rpc/usage/plan", (route) =>
    route.fulfill({
      json: {
        json: {
          plan: "personal",
          computerSize: "small",
          computers: { used: 0, limit: 1 },
          storage: { usedBytes: 0, limitBytes: 25 * 1024 ** 3 },
          seats: { used: 1, included: 1, max: 1, extraPrice: null },
          plans: [
            plan("personal", 1, 1, "small", 1, 25),
            plan("team", 10, 15, "medium", 1, 50),
            plan("company", 25, 50, "large", 1, 200),
          ],
          canManage: true,
        },
      },
    }),
  );
  let checkoutInput: unknown;
  await page.route("**/rpc/billing/planCheckout", async (route) => {
    checkoutInput = (route.request().postDataJSON() as { json: unknown }).json;
    await route.fulfill({ json: { json: { url: "http://127.0.0.1:1/checkout" } } });
  });
  await page.reload();

  const paywall = page.getByTestId("billing-paywall");
  await expect(paywall.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
  for (const name of ["Personal", "Team", "Company"]) {
    await expect(paywall.getByRole("heading", { name })).toBeVisible();
  }
  await expect(paywall.getByText("Ready in minutes")).toHaveCount(1);
  await captureScreenshot(page, testInfo, "billing-plans");

  await paywall.getByRole("button", { name: "Yearly" }).click();
  await paywall.getByRole("button", { name: "Subscribe to Team" }).click();
  await expect
    .poll(() => checkoutInput)
    .toEqual({
      plan: "team",
      interval: "year",
      currency: "usd",
      aiUseCents: 1000,
    });
});

test("settings billing puts the plan first, with the plans inline until one is held", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `settings-plans-${stamp}@corvo.test`, "password12", `Settings ${stamp}`);
  await completeOnboarding(page);

  await page.route("**/api/auth/capabilities", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), billing: true } });
  });
  await page.route("**/rpc/me", (route) => enableBilling(route, "me"));
  await page.route("**/rpc/bootstrap", (route) => enableBilling(route, "bootstrap"));
  const credits = {
    access: true,
    funding: "credits",
    creditPurchasesEnabled: true,
    balanceUsd: 10,
    monthlyAmountCents: null,
  };
  let status = billingStatus(credits);
  await page.route("**/rpc/billing/status", (route) => route.fulfill({ json: { json: status } }));
  const plan = (
    name: string,
    seats: number,
    maxSeats: number,
    size: string,
    computers: number,
    gb: number,
  ) => ({
    plan: name,
    computerSize: size,
    computers,
    storageBytes: gb * 1024 ** 3,
    seatsIncluded: seats,
    maxSeats,
  });
  await page.route("**/rpc/usage/plan", (route) =>
    route.fulfill({
      json: {
        json: {
          plan: "team",
          computerSize: "medium",
          computers: { used: 0, limit: 1 },
          storage: { usedBytes: 0, limitBytes: 50 * 1024 ** 3 },
          seats: { used: 1, included: 10, max: 15, extraPrice: null },
          plans: [
            plan("personal", 1, 1, "small", 1, 25),
            plan("team", 10, 15, "medium", 1, 50),
            plan("company", 25, 50, "large", 1, 200),
          ],
          canManage: true,
        },
      },
    }),
  );
  await page.reload();

  // No plan yet: the plans come first, with a button each, and the old monthly credits are gone.
  const settings = await openUserSettings(page, "billing");
  const section = settings.getByTestId("plan-section");
  await expect(section.getByRole("button", { name: "Subscribe to Team" })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Monthly credits" })).toHaveCount(0);
  await expect(settings.getByText("$10.00", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "settings-billing-no-plan");

  // Subscribed: the plan, its renewal and the two actions, then the credits.
  status = billingStatus({
    ...credits,
    state: "active",
    plan: "team",
    currency: "usd",
    interval: "month",
    aiUseCents: 1000,
    hasCustomer: true,
    currentPeriodEndsAt: "2030-01-15T12:00:00.000Z",
  });
  await page.reload();
  const subscribed = page.getByTestId("settings-page").getByTestId("plan-section");
  await expect(subscribed.getByText("Team", { exact: true })).toBeVisible();
  await expect(subscribed.getByText(/^Renews /)).toBeVisible();
  await expect(subscribed.getByRole("button", { name: "Manage billing" })).toBeVisible();
  await captureScreenshot(page, testInfo, "settings-billing-subscribed");
  await subscribed.getByRole("button", { name: "Change plan" }).click();
  await expect(subscribed.getByRole("button", { name: "Current plan" })).toBeDisabled();
  await captureScreenshot(page, testInfo, "settings-billing-change-plan");
});
