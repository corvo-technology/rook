import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, rpc, signupKeepingTour } from "./helpers";

test.describe.configure({ mode: "serial" });

const CHIEF_MARK = "Stuck? Ask the Chief.";
const ASK_MARK = "When an agent needs you, it asks here and waits.";

/**
 * A new account that has a Chief and one other bot, opened on the other bot. Opening the Chief's
 * chat ends its mark, so the account never lands there on its own.
 */
async function startTour(page: Page, name: string) {
  await signupKeepingTour(page, `${name}-${Date.now()}@corvo.test`, "password12", name);
  await rpc(page, "onboarding/ensureTeam", { locale: "en" });
  const other = await rpc<{ id: string }>(page, "bots/create", {
    name: "Alpha",
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: true,
    computerMode: "team",
  });
  await page.goto(`/app/${other.id}`);
  return other.id;
}

test("the chief mark shows after the first reply and ends when the Chief's chat opens", async ({
  page,
}, testInfo) => {
  const botId = await startTour(page, "Tour chief");
  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("hello");
  await page.keyboard.press("Enter");

  const mark = page.getByText(CHIEF_MARK, { exact: true });
  await expect(mark).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "coach-tour-chief");

  await page.locator('[data-coach="chief"]').click();
  await expect(mark).toHaveCount(0);

  await page.reload();
  await page.locator(`[data-roster-bot-id="${botId}"]`).click();
  await expect(page.getByPlaceholder(/Message/)).toBeVisible();
  await expect(mark).toHaveCount(0);
});

test("the ask mark shows over a real question and ends when it is answered", async ({
  page,
}, testInfo) => {
  await startTour(page, "Tour ask");
  await page.getByPlaceholder(/Message/).fill("ask me which city to use");
  await page.keyboard.press("Enter");

  const mark = page.getByText(ASK_MARK, { exact: true });
  await expect(mark).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "coach-tour-ask");

  await page.getByRole("button", { name: "Edit first" }).click();
  await page.getByRole("textbox", { name: "Answer" }).fill("ask me which city to use again");
  await page.getByRole("button", { name: "Send answer" }).click();

  await expect(mark).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit first" })).toBeVisible({ timeout: 30_000 });
  await expect(mark).toHaveCount(0);
});

test("skip ends the tour", async ({ page }) => {
  await startTour(page, "Tour skip");
  await page.getByPlaceholder(/Message/).fill("ask me which city to use");
  await page.keyboard.press("Enter");

  await expect(page.getByText(ASK_MARK, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByText(ASK_MARK, { exact: true })).toHaveCount(0);

  await page.reload();
  await page.getByPlaceholder(/Message/).fill("ask me which city to use");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Edit first" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(ASK_MARK, { exact: true })).toHaveCount(0);

  const me = await rpc<{ tour: { skipped: boolean } }>(page, "me", {});
  expect(me.tour.skipped).toBe(true);
});
