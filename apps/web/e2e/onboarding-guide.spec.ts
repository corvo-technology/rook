import { expect, test } from "@playwright/test";
import { captureScreenshot, signupToOnboarding } from "./helpers";

test("one rook guides the first run and moves to the next step", async ({ page }, testInfo) => {
  await signupToOnboarding(page, `guide-${Date.now()}@corvo.test`, "password12", "Guide");
  const rook = page.locator("[data-guide-rook]");
  await expect(rook).toHaveAttribute("data-guide-rook", "workspace");
  await expect(rook).toHaveCount(1);
  await captureScreenshot(page, testInfo, "onboarding-guide-workspace");

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(rook).toHaveAttribute("data-guide-rook", "survey");
  await expect(rook).toHaveCount(1);
  await captureScreenshot(page, testInfo, "onboarding-guide-use");
});
