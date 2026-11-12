import { BOT_AVATAR_CHARACTER_IDS } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1000, height: 1000 } });

test("every character is drawn in the agent's color, at every size", async ({ page }) => {
  await page.goto("/e2e/fixtures/avatar-characters.html?theme=dark&color=%238B5CF6");
  const characters = page.getByTestId("characters");
  await expect(characters.locator("[data-character]")).toHaveCount(
    BOT_AVATAR_CHARACTER_IDS.length * 3,
  );
  for (const id of ["king", "knight", "ghost", "witch-hat", "paint-brush", "watering-can"]) {
    const card = page.getByTestId(`character-${id}`);
    await expect(card.locator("[data-character]").first()).toBeVisible();
    expect(await card.locator("svg").count(), id).toBeGreaterThan(0);
  }
});

test("a small character stands still and a large one follows the pointer", async ({ page }) => {
  await page.goto("/e2e/fixtures/avatar-characters.html?theme=dark");
  const avatars = page.getByTestId("character-cat").locator("[data-character]");
  const [large, small] = [avatars.nth(0), avatars.nth(1)];
  await page.mouse.move(5, 5);
  await page.waitForTimeout(900);
  const before = [await large.screenshot(), await small.screenshot()];
  await page.mouse.move(990, 990);
  await page.waitForTimeout(900);
  const after = [await large.screenshot(), await small.screenshot()];
  expect(after[0].equals(before[0])).toBe(false);
  expect(after[1].equals(before[1])).toBe(true);
});

for (const theme of ["light", "dark"]) {
  test(`a character is chosen in Avatar Studio and keeps the color that is picked after (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/avatar-characters.html?theme=${theme}&color=%238B5CF6`);
    await page.getByTestId("avatar-studio-trigger").click();
    const studio = page.getByTestId("avatar-studio");
    await expect(studio.getByRole("tab", { name: "Character", exact: true })).toBeVisible();
    await studio.getByRole("tab", { name: "Character", exact: true }).click();

    const picker = studio.getByTestId("avatar-studio-characters");
    await expect(picker.getByRole("button")).toHaveCount(23);
    await expect(picker.getByRole("button", { name: "Default" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await picker.getByRole("button", { name: "Ghost" }).click();
    await expect(picker.getByRole("button", { name: "Ghost" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("studio-value")).toHaveText("#8B5CF6::char_ghost");
    await expect(studio.locator('[data-character="ghost"]').first()).toBeVisible();

    // A color chosen next is worn by the same character.
    await studio.getByRole("tab", { name: "Bot", exact: true }).click();
    await studio.getByRole("button", { name: "Color #EAB308" }).click();
    await expect(page.getByTestId("studio-value")).toHaveText("#EAB308::char_ghost");
    await captureScreenshot(page, testInfo, `avatar-characters-${theme}`);

    // Reset goes back to the chick, in the same color.
    await studio.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByTestId("studio-value")).toHaveText("#EAB308");
    await expect(studio.locator("[data-mascot]").first()).toBeVisible();
  });
}
