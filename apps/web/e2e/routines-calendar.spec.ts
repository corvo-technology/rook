import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const todayAt = (hour: number, dayOffset = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour).toISOString();
};

test("routines are a calendar by the hour that says whether everything ran", async ({
  page,
}, testInfo) => {
  await signup(page, `routines-calendar-${Date.now()}@corvo.test`, "password12", "Calendar QA");
  await completeOnboarding(page, testInfo);
  const entry = (name: string, state: string, hour: number, dayOffset = 0) => ({
    routineId: `${name}-${hour}`,
    name,
    botId: "unknown-bot",
    botName: "Rook",
    at: todayAt(hour, dayOffset),
    state,
    runId: null,
  });
  await page.route("**/rpc/routines/calendar", (route) =>
    route.fulfill({
      json: {
        json: {
          occurrences: [
            entry("Morning summary", "done", 8),
            entry("Weekly report", "failed", 9),
            entry("Post to social media", "upcoming", 18, 1),
          ],
          truncated: false,
        },
      },
    }),
  );
  await page.goto("/app/routines");

  await expect(page.getByRole("button", { name: /1 failed/ })).toBeVisible();
  await expect(page.getByTestId("routine-day")).toHaveCount(7);
  await expect(page.getByRole("button", { name: /^Morning summary, .*, Done$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Weekly report, .*, Failed$/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "routines-calendar-week");

  await page.getByRole("button", { name: /1 failed/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Weekly report");
  await expect(page.getByRole("dialog")).toContainText("Failed");
  await captureScreenshot(page, testInfo, "routines-calendar-failed");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByRole("button", { name: /Morning summary/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "routines-calendar-month");
});
