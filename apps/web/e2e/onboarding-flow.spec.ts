import type { Bot } from "@corvo/contracts";
import { AGENT_CATALOG } from "@corvo/core";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, rpc, signup, signupToOnboarding } from "./helpers";

const CHIEF_KEY = "onboarding:first";

test("a new user who picks Sales lands in the prospector's chat with the first task waiting", async ({
  page,
}, testInfo) => {
  await signupToOnboarding(page, `flow-${Date.now()}@corvo.test`, "password12", "Flow");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });

  const bots = await rpc<Bot[]>(page, "bots/list", {});
  const picked = bots.find((bot) => bot.id === activeBotId(page));
  expect(picked?.spawnKey).toBe("agent-catalog:sales-prospector");
  expect(bots.filter((bot) => bot.spawnKey === CHIEF_KEY)).toHaveLength(1);

  const task = AGENT_CATALOG.find((entry) => entry.slug === "sales-prospector")?.firstTask?.en;
  await expect(page.getByPlaceholder(/Message/)).toHaveValue(task ?? "missing");
  const thread = await rpc<{ messages: unknown[] }>(page, "threads/get", {
    botId: activeBotId(page),
  });
  expect(thread.messages).toHaveLength(0);
  await captureScreenshot(page, testInfo, "flow-first-task-waiting");
});

test("a new user who picks nothing lands in the Chief's chat with an empty composer", async ({
  page,
}) => {
  await signupToOnboarding(page, `flow-none-${Date.now()}@corvo.test`, "password12", "Flow");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });

  const bots = await rpc<Bot[]>(page, "bots/list", {});
  expect(bots.find((bot) => bot.id === activeBotId(page))?.spawnKey).toBe(CHIEF_KEY);
  await expect(page.getByPlaceholder(/Message/)).toHaveValue("");
});

test("renaming the workspace shows the new name in the sidebar", async ({ page }) => {
  await signupToOnboarding(page, `flow-name-${Date.now()}@corvo.test`, "password12", "Flow name");
  await page.getByRole("textbox", { name: "Name your workspace" }).fill("Alves Studio");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Alves Studio" })).toBeVisible();
});

test("the computer step is not offered on web", async ({ page }) => {
  await signupToOnboarding(page, `flow-computer-${Date.now()}@corvo.test`, "password12", "Flow");
  await page.goto("/onboarding/computer");
  await expect(page.getByRole("heading", { name: "Where should bots run?" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Name your workspace" })).toBeVisible();
});

test("reloading the first-bot step does not make a second Chief or a second agent", async ({
  page,
}) => {
  await signupToOnboarding(page, `flow-reload-${Date.now()}@corvo.test`, "password12", "Flow");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  await page.goto("/onboarding/bot");
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  await expect
    .poll(async () => {
      const bots = await rpc<Bot[]>(page, "bots/list", {});
      return [
        bots.filter((bot) => bot.spawnKey === CHIEF_KEY).length,
        bots.filter((bot) => bot.spawnKey === "agent-catalog:sales-prospector").length,
      ];
    })
    .toEqual([1, 1]);
});

test("an account that already has a bot goes straight to its chat from /onboarding", async ({
  page,
}) => {
  await signup(page, `flow-existing-${Date.now()}@corvo.test`, "password12", "Flow");
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  await page.goto("/onboarding");
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Name your workspace" })).toHaveCount(0);
});
