import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1000, height: 760 } });

test("pending approvals in a channel are allowed together", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/channel-approvals.html");
  const main = page.locator("main").getByTestId("transcript");
  const allowAll = main.getByRole("button", { name: "Approve all 3" });
  await expect(allowAll).toBeVisible();
  // Each card keeps its own choices.
  await expect(main.getByRole("button", { name: "Allow once" })).toHaveCount(3);
  await captureScreenshot(page, testInfo, "channel-approvals-pending");

  await allowAll.click();
  await expect(main.getByTestId("ask-decided")).toHaveCount(3);
  await expect(main.getByRole("button", { name: /Approve all/ })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "channel-approvals-decided");
});

test("a card that could not be allowed stays pending and is counted", async ({
  page,
}, testInfo) => {
  await page.goto("/e2e/fixtures/channel-approvals.html?fail");
  const main = page.locator("main").getByTestId("transcript");
  await main.getByRole("button", { name: "Approve all 3" }).click();
  await expect(main.getByTestId("ask-decided")).toHaveCount(2);
  await expect(main.getByText("1 could not be approved")).toBeVisible();
  await expect(main.getByRole("button", { name: "Allow once" })).toHaveCount(1);
  await captureScreenshot(page, testInfo, "channel-approvals-partial");
});

test("a single pending approval has no batch action", async ({ page }) => {
  await page.goto("/e2e/fixtures/channel-approvals.html");
  const main = page.locator("main").getByTestId("transcript");
  await main.getByRole("button", { name: "Allow once" }).first().click();
  await main.getByRole("button", { name: "Allow once" }).first().click();
  await expect(main.getByRole("button", { name: /Approve all/ })).toHaveCount(0);
});
