import type { Routine } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

const TITLES = [
  "Talk to your agent",
  "Answer a request",
  "Connect an app",
  "Add a second agent",
  "Schedule a routine",
  "Keep a memory",
];

test("a new account starts with a short bar, and a mission brings its part, marked until opened", async ({
  page,
}, testInfo) => {
  await signup(page, `missions-${Date.now()}@corvo.test`, "password12", "Missions");
  await completeOnboarding(page);
  const rail = page.getByTestId("sidebar-nav");
  await expect(rail.getByRole("button", { name: "Routines", exact: true })).toHaveCount(0);
  const list = page.getByRole("list", { name: "Missions" });
  await expect(list.getByRole("listitem")).toHaveText(TITLES);
  await captureScreenshot(page, testInfo, "missions-short-nav");

  await rpc<Routine>(page, "routines/create", {
    botId: activeBotId(page),
    name: "Daily check",
    prompt: "Say hello",
    crons: ["0 9 * * *"],
    timezone: "UTC",
    active: true,
    notify: true,
  });
  await page.reload();
  const routines = rail.getByRole("button", { name: "Routines", exact: true });
  await expect(routines).toBeVisible();
  await expect(routines.getByText("New")).toBeAttached();

  await routines.click();
  await page.waitForURL(/\/app\/routines/);
  await page.reload();
  await expect(routines).toBeVisible();
  await expect(routines.getByText("New")).toHaveCount(0);
});

test("Show everything brings the whole bar and removes the list for good", async ({ page }) => {
  await signup(page, `missions-all-${Date.now()}@corvo.test`, "password12", "Missions all");
  await completeOnboarding(page);
  const rail = page.getByTestId("sidebar-nav");
  await page.getByRole("button", { name: "Show everything", exact: true }).click();
  await expect(rail.getByRole("button", { name: "Routines", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Missions" })).toHaveCount(0);
  await page.reload();
  await expect(rail.getByRole("button", { name: "Routines", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Missions" })).toHaveCount(0);
});
