import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("a person and a space can wear their own color", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const userName = `Avatar Person ${stamp}`;
  await signup(page, `people-avatars-${stamp}@corvo.test`, "password12", userName);
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  const footer = sidebar.getByTestId("sidebar-footer");
  await expect(footer.getByTestId("user-menu-trigger")).toContainText(userName);

  // The person picks a color in General; the sidebar footer wears it at once.
  const settings = await openUserSettings(page);
  const person = settings.getByTestId("account-card").getByTestId("avatar-editor");
  const personColor = person.getByRole("button", { name: "Color 6", exact: true });
  await personColor.click();
  await expect(personColor).toHaveAttribute("aria-pressed", "true");
  await expect(person.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "account-settings-avatar");
  await expect(footer.locator("span[style*='background-color']").first()).toBeVisible();

  // The space's own page offers the same, on a rounded square.
  await page.getByRole("button", { name: "Back" }).click();
  await sidebar
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const spaceSettings = page.getByTestId("space-settings");
  const space = spaceSettings.getByTestId("avatar-editor");
  const spaceColor = space.getByRole("button", { name: "Color 7", exact: true });
  await spaceColor.click();
  await expect(spaceColor).toHaveAttribute("aria-pressed", "true");
  await captureScreenshot(page, testInfo, "space-settings-avatar");
  await page.keyboard.press("Escape");

  const switcher = sidebar.getByTestId("space-switcher");
  await expect(switcher.getByTestId("space-avatar")).toHaveAttribute("style", /background-color/);
  await switcher.click();
  await captureScreenshot(page, testInfo, "space-switcher-avatar");
});
