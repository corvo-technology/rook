import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("a slow page waits on the rook, thinking and then working", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const stamp = Date.now();
  await signup(page, `loader-${stamp}@corvo.test`, "password12", "Loader");
  await completeOnboarding(page);

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/routines/calendar", async (route) => {
    await held;
    await route.continue();
  });

  await page.getByTestId("sidebar-routines").click();
  const loader = page.locator("[data-slot=agent-loader]");
  await expect(loader).toBeVisible();
  await expect(loader).toHaveAttribute("data-status", "queued");
  await expect(loader.locator("canvas, svg").first()).toBeVisible();
  await captureScreenshot(page, testInfo, "agent-loader-thinking");

  // Past about a second and a half the same avatar goes from thinking to working.
  await expect(loader).toHaveAttribute("data-status", "running", { timeout: 5_000 });
  await captureScreenshot(page, testInfo, "agent-loader-working");

  release();
  await expect(loader).toBeHidden();
});

test("under reduced motion the loader is a still rook", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signup(page, `loader-still-${Date.now()}@corvo.test`, "password12", "Still");
  await completeOnboarding(page);

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/routines/calendar", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByTestId("sidebar-routines").click();
  await expect(page.getByRole("status", { name: "Loading…" })).toBeVisible();
  release();
});
