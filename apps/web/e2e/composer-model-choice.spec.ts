import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  openModelConnection,
  openUserSettings,
  rpc,
  signup,
} from "./helpers";

test("the composer picks a model for the next message only", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const stamp = Date.now();
  await signup(page, `message-model-${stamp}@corvo.test`, "password12", "Sample");
  await completeOnboarding(page);
  await rpc(page, "onboarding/dismissFocus", { botId: activeBotId(page) });

  // With one model to run there is nothing to pick, so the composer shows no control.
  const chip = page.locator('[id^="message-model-"]');
  await expect(page.getByRole("combobox", { name: /Message/ })).toBeVisible();
  await expect(chip).toHaveCount(0);

  await openUserSettings(page, "models");
  const dialog = await openModelConnection(page, "OpenRouter");
  await dialog.getByLabel("API key").fill("fake-message-model-key");
  await dialog.getByRole("button", { name: "Connect API key", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByTestId("settings-back").click();

  await expect(chip).toBeVisible();
  const own = ((await chip.textContent()) ?? "").trim();
  await chip.click();
  await page.getByRole("combobox", { name: "Search models" }).fill("claude");
  const option = page.getByRole("option").first();
  const picked = ((await option.textContent()) ?? "").trim();
  expect(picked).not.toBe("");
  await expect(page.getByText("For this conversation")).toBeVisible();
  await captureScreenshot(page, testInfo, "composer-model-choice");
  await option.click();
  await expect(chip).toContainText(picked);

  // The choice goes with the next message and then the agent's own model is back.
  const composer = page.getByRole("combobox", { name: /Message/ });
  await composer.fill("Which model is this?");
  await composer.press("Enter");
  await expect(page.getByTestId("transcript").getByText("Which model is this?")).toBeVisible();
  await expect(chip).toContainText(own);
});
