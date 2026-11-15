import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("the owner opens the database connection form, which hides the connection string", async ({
  page,
}, testInfo) => {
  await signup(page, `databases-${Date.now()}@corvo.test`, "password12", "Databases");
  await completeOnboarding(page);
  await page.goto("/settings/databases");
  const panel = page.getByTestId("databases-settings");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Add database", exact: true }).click();
  await expect(panel.getByLabel("Connection string")).toHaveAttribute("type", "password");
  await expect(panel.getByText("Use a read-only database role.", { exact: true })).toBeVisible();
  await panel.getByLabel("Name", { exact: true }).fill("Sales");
  await panel.getByRole("button", { name: "Details", exact: true }).click();
  await expect(panel.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await captureScreenshot(page, testInfo, "databases-form");
});
