import { expect, test } from "@playwright/test";
import { captureScreenshot, signup, signupToOnboarding } from "./helpers";

test("new users choose how to start before their first chat", async ({ page }, testInfo) => {
  await signupToOnboarding(page, `survey-${Date.now()}@corvo.test`, "password12", "Survey");

  await expect(page.getByRole("heading", { name: "Name your workspace" })).toBeVisible();
  await captureScreenshot(page, testInfo, "01-workspace");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "What do you do?" })).toBeVisible();
  await page.getByRole("button", { name: "Agency", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/start$/);
  await captureScreenshot(page, testInfo, "02-use");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page).toHaveURL(/\/onboarding\/bot$/);
  await captureScreenshot(page, testInfo, "03-first-bot");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invite your team" })).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.waitForURL(/\/app\/home$/, { timeout: 20_000 });
});

test("each onboarding step opens directly from its URL while it applies", async ({ page }) => {
  await signup(page, `step-links-${Date.now()}@corvo.test`, "password12", "Step links");
  await page.waitForURL(/\/app\//, { timeout: 20_000 });

  await page.goto("/onboarding/survey");
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();

  // No model is due, so that step is not offered; every step is done, so the last one opens.
  await page.goto("/onboarding/model");
  await expect(page.getByRole("heading", { name: "Connect a model" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invite your team" })).toBeVisible();

  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({ response, json: { json: { ...body.json, needsModel: true } } });
  });
  await page.goto("/onboarding/model");
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/model$/);
});
