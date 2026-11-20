import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

async function send(page: Page, text: string) {
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(text);
  const button = page.getByRole("button", { name: "Send", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(composer).toHaveValue("");
}

/** Opens the "More" menu of the message row and picks one entry. */
async function chooseFromMore(page: Page, row: Locator, entry: string) {
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: entry, exact: true }).click();
}

test("regenerating or editing keeps the earlier version one click away", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `versions-${stamp}@corvo.test`, "password12", "Versions");
  await completeOnboarding(page);
  const transcript = page.getByTestId("transcript");
  const row = (text: string) => transcript.locator("[data-message-id]").filter({ hasText: text });
  const switcher = page.getByTestId("version-switcher");

  const first = `versions-alpha-${stamp}`;
  await send(page, first);
  await expect(row(`done. i handled: ${first}`)).toBeVisible({ timeout: 30_000 });
  await expect(switcher).toHaveCount(0);

  // Regenerate: the new reply opens a second version of the same point.
  await chooseFromMore(page, row(`done. i handled: ${first}`), "Regenerate");
  await expect(switcher).toHaveText("2 of 2", { timeout: 30_000 });
  await switcher.getByRole("button", { name: "Previous version" }).click();
  await expect(switcher).toHaveText("1 of 2");
  await expect(row(`done. i handled: ${first}`)).toHaveCount(1);
  await switcher.getByRole("button", { name: "Next version" }).click();
  await expect(switcher).toHaveText("2 of 2");

  // Edit: the edited message opens a second version of the conversation from there.
  const second = `versions-beta-${stamp}`;
  await chooseFromMore(page, row(first).first(), "Edit");
  await page.getByRole("textbox", { name: "Edit message" }).fill(second);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row(`done. i handled: ${second}`)).toBeVisible({ timeout: 30_000 });
  await expect(row(`done. i handled: ${first}`)).toHaveCount(0);
  await expect(switcher.last()).toHaveText("2 of 2");
  await captureScreenshot(page, testInfo, "message-versions-edited-desktop");

  await switcher.last().getByRole("button", { name: "Previous version" }).click();
  await expect(row(`done. i handled: ${first}`)).toBeVisible();
  await expect(row(`done. i handled: ${second}`)).toHaveCount(0);
  await captureScreenshot(page, testInfo, "message-versions-original-desktop");
});
