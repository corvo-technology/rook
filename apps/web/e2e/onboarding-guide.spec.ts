import { expect, test } from "@playwright/test";
import { captureScreenshot, signupToOnboarding } from "./helpers";

test("the Rook narrates each step and the preview follows the answers", async ({
  page,
}, testInfo) => {
  await signupToOnboarding(page, `guide-${Date.now()}@corvo.test`, "password12", "Guide");
  const narration = page.getByTestId("onboarding-narration");
  await expect(narration).toContainText("I'm Rook");
  await page.getByRole("textbox").first().fill("Alves Studio");
  await expect(page.getByTestId("preview-name")).toHaveText("Alves Studio");
  await captureScreenshot(page, testInfo, "onboarding-narration-workspace");

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(narration).toContainText("What does the workspace do?");
  await expect(page.getByTestId("onboarding-rail")).toContainText("Alves Studio");
});
