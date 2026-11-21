import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("a card says once that the person allowed this tool every time", async ({
  page,
}, testInfo) => {
  await page.goto("/e2e/fixtures/approval-learning.html?learned=1");
  await expect(
    page.getByText(
      "You have allowed this every time. Always allow covers crm_update_contact on crm, for Ana only.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Always allow", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "approval-learning-card");
});

test("an ordinary card keeps the plain coverage line", async ({ page }) => {
  await page.goto("/e2e/fixtures/approval-learning.html");
  await expect(
    page.getByText("Always allow covers crm_update_contact on crm, for Ana only."),
  ).toBeVisible();
  await expect(page.getByText("You have allowed this every time.")).toHaveCount(0);
});
