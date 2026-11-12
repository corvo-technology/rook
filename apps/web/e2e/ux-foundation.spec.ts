import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

for (const theme of ["light", "dark"] as const) {
  test(`a side panel and the settings page, ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("corvo.uiAppearance", value), theme);
    await signup(page, `ux-foundation-${theme}-${Date.now()}@corvo.test`, "password12", "UX QA");
    await completeOnboarding(page, testInfo);

    // Create flows open in a side panel: the page stays usable and the URL carries the panel.
    await page.goto("/app/routines");
    await page.getByRole("button", { name: /New routine/ }).click();
    const panel = page.getByTestId("side-panel-layer");
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/panel=new-routine/);
    await expect(panel.getByRole("heading", { name: "New routine" })).toBeVisible();
    await expect(panel.getByLabel("Name")).toBeFocused();
    await expect(page.getByRole("button", { name: "Week", exact: true })).toBeEnabled();
    await captureScreenshot(page, testInfo, `side-panel-${theme}`);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).not.toHaveURL(/panel=/);

    // Settings is a page with a route per section; Esc returns to where the person came from.
    await page.goto("/app?settings=confirmations");
    await expect(page).toHaveURL(/\/settings\/approvals$/);
    const settings = page.getByTestId("settings-page");
    await expect(settings.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
    await captureScreenshot(page, testInfo, `settings-page-${theme}`);
    await page.reload();
    await expect(settings.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
    await settings.getByTestId("settings-back").click();
    await expect(page).toHaveURL(/\/app\/[^/]+$/);
  });
}
