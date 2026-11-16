import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("the old databases page lands on Connections, where the form hides the connection string", async ({
  page,
}, testInfo) => {
  await signup(page, `databases-${Date.now()}@corvo.test`, "password12", "Databases");
  await completeOnboarding(page);
  await page.goto("/settings/databases");
  await expect(page).toHaveURL(/\/settings\/connections$/);
  await expect(page.getByTestId("connections-page")).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const sheet = page.getByTestId("connect-sheet");
  await sheet.getByRole("button", { name: "Database", exact: true }).click();
  const form = sheet.getByTestId("database-form");
  await expect(form.getByLabel("Connection string")).toHaveAttribute("type", "password");
  await expect(form.getByText("Use a read-only database role.", { exact: true })).toBeVisible();
  await form.getByLabel("Name", { exact: true }).fill("Sales");
  await form.getByRole("button", { name: "Details", exact: true }).click();
  await expect(form.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await captureScreenshot(page, testInfo, "databases-form");
});

test("the old servers and mailboxes pages land on Connections too", async ({ page }) => {
  await signup(page, `moved-${Date.now()}@corvo.test`, "password12", "Moved");
  await completeOnboarding(page);
  for (const old of ["mcp", "mailboxes"]) {
    await page.goto(`/settings/${old}`);
    await expect(page).toHaveURL(/\/settings\/connections$/);
    await expect(page.getByTestId("connections-page")).toBeVisible();
  }
});
