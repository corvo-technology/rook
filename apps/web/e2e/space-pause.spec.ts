import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("pausing a space stops new runs until it is resumed", async ({ page }, testInfo) => {
  await signup(page, `space-pause-${Date.now()}@corvo.test`, "password12", "Space Owner");
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  await sidebar.getByRole("button", { name: "Actions for Personal" }).click();
  await page.getByRole("menuitem", { name: "Pause all bots" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText("Running work stops and nothing starts until you resume."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Pause all bots" }).click();
  await expect(sidebar.getByText("Paused", { exact: true })).toBeVisible();

  const composer = page.getByRole("combobox", { name: /Message/ });
  await composer.fill("hello while paused");
  await composer.press("Enter");
  const error = page.getByTestId("composer-error");
  await expect(error).toContainText("Bots are paused in this space.", { timeout: 15_000 });
  await captureScreenshot(page, testInfo, "space-paused-run-error");

  await error.getByRole("button", { name: "Resume" }).click();
  await expect(sidebar.getByText("Paused", { exact: true })).toBeHidden();

  await composer.fill("hello after resume");
  await composer.press("Enter");
  await expect(
    page.getByTestId("transcript").getByText("hello after resume", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("composer-error")).toBeHidden({ timeout: 15_000 });
});
