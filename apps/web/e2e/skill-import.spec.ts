import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("an owner adds a skill by writing it, sees it listed and removes it", async ({
  page,
}, testInfo) => {
  await signup(page, `skill-import-${Date.now()}@corvo.test`, "password12", "Skill Import");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const settings = await openUserSettings(page, "skills");
  await expect(settings.getByTestId("skills-settings")).toBeVisible();
  await captureScreenshot(page, testInfo, "skills-empty");

  await settings.getByRole("button", { name: "Add skill", exact: true }).click();
  const panel = page.getByTestId("add-skill-panel");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/panel=add-skill/);
  await captureScreenshot(page, testInfo, "skill-add-link");

  // A link to any host but GitHub is refused by the server before any request leaves it.
  await panel.getByLabel("GitHub link").fill("https://example.com/acme/skills");
  await panel.getByRole("button", { name: "Add skill", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();

  await panel.getByRole("tab", { name: "Upload .zip" }).click();
  await expect(panel.getByRole("button", { name: "Choose a .zip" })).toBeVisible();
  await captureScreenshot(page, testInfo, "skill-add-zip");

  await panel.getByRole("tab", { name: "Write" }).click();
  await panel.getByLabel("Name").fill("Weekly review");
  await panel.getByLabel("When to use").fill("When the week ends and the owner wants a recap.");
  await panel.getByLabel("Instructions").fill("List the wins, the blockers and the next steps.");
  await captureScreenshot(page, testInfo, "skill-add-write");
  await panel.getByRole("button", { name: "Add skill", exact: true }).click();

  await expect(panel).toHaveCount(0);
  const list = settings.getByTestId("skills-settings");
  await expect(list).toContainText("Weekly review");
  await expect(list).toContainText("When the week ends and the owner wants a recap.");
  await captureScreenshot(page, testInfo, "skills-listed");

  const remove = list.getByRole("button", { name: "Remove Weekly review" });
  await remove.click();
  await remove.click();
  await expect(list).not.toContainText("Weekly review");
});
