import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("quiet hours save on the account and survive a reload", async ({ page }, testInfo) => {
  await signup(page, `quiet-hours-${Date.now()}@corvo.test`, "password12", "Quiet QA");
  await completeOnboarding(page);

  const settings = await openUserSettings(page);
  const quiet = settings.getByTestId("quiet-hours-settings");

  // On from 22:00 to 08:00 until the person changes it.
  await expect(quiet.getByTestId("quiet-hours-toggle")).toBeChecked();
  await expect(quiet.getByLabel("Start")).toHaveValue("22:00");
  await expect(quiet.getByLabel("End")).toHaveValue("08:00");

  await quiet.getByLabel("Start").fill("23:30");
  await quiet.getByLabel("End").fill("07:15");
  await quiet.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "quiet-hours-setting");

  await page.reload();
  const reopened = page.getByTestId("settings-page").getByTestId("quiet-hours-settings");
  await expect(reopened.getByLabel("Start")).toHaveValue("23:30");
  await expect(reopened.getByLabel("End")).toHaveValue("07:15");

  await reopened.getByTestId("quiet-hours-toggle").click();
  await expect(reopened.getByLabel("Start")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByTestId("settings-page").getByTestId("quiet-hours-toggle"),
  ).not.toBeChecked();
});

test("an agent can be muted for an hour and unmuted from its menu", async ({ page }, testInfo) => {
  await signup(page, `mute-${Date.now()}@corvo.test`, "password12", "Mute QA");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const bot = page
    .locator("aside")
    .first()
    .getByRole("button", { name: /^Chief/ });
  await bot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mute", exact: true }).hover();
  await expect(page.getByRole("menuitem", { name: "Until tomorrow" })).toBeVisible();
  await captureScreenshot(page, testInfo, "mute-menu");
  await page.getByRole("menuitem", { name: "For 1 hour" }).click();

  await bot.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Unmute", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Unmute", exact: true }).click();

  await bot.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Mute", exact: true })).toBeVisible();
});
