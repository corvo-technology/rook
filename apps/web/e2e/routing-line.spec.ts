import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 900, height: 520 } });

for (const theme of ["light", "dark"]) {
  test(`a channel message says who the router picked and why (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/routing-line.html?theme=${theme}`);
    const lines = page.getByTestId("routing-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("CTO, Financeiro");
    await expect(lines.nth(1)).toHaveText("No one answered");
    await captureScreenshot(page, testInfo, `routing-line-${theme}`);

    await lines.nth(0).click();
    const popover = page.getByTestId("routing-popover");
    await expect(popover).toContainText("CTOPicked for this");
    await expect(popover).toContainText("ChefeNot available to you");
    await expect(popover).toContainText("Router's note: Invoices and a build failure");
    await captureScreenshot(page, testInfo, `routing-popover-${theme}`);
  });
}
