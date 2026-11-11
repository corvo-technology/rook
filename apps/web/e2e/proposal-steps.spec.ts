import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("several proposals from one reply are stepped through one card at a time", async ({
  page,
}, testInfo) => {
  await signup(page, `proposal-steps-${Date.now()}@corvo.test`, "password12", "Proposal Steps");
  await completeOnboarding(page);
  await page.waitForURL(/\/app\/[^/]+$/);
  const chiefId = activeBotId(page);
  await rpc(page, "bots/update", { botId: chiefId, fleetManagement: true });
  await rpc(page, "models/connect", {
    provider: "openai",
    apiKey: "test-key-not-a-real-secret",
    label: "Test",
    modelId: "gpt-6-sol",
  });
  for (const name of ["Alpha", "Beta"]) {
    await rpc(page, "bots/create", { name, title: "", description: "", notifyOnFinish: true });
  }
  const bots = await rpc<Array<{ id: string; name: string }>>(page, "bots/list", {});
  const ids = ["Alpha", "Beta"].map((name) => {
    const bot = bots.find((candidate) => candidate.name === name);
    if (!bot) throw new Error(`Missing bot ${name}`);
    return bot.id;
  });

  const composer = page.getByPlaceholder("Message Chief");
  await expect(composer).toBeEnabled();
  await composer.fill(`set the models of bots ${ids[0]} and ${ids[1]} to openai/gpt-6-luna`);
  await page.keyboard.press("Enter");

  const transcript = page.getByTestId("transcript");
  await expect(transcript.getByText("1 of 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(transcript.getByRole("button", { name: "Apply", exact: true })).toHaveCount(1);
  await expect(transcript.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "proposal-steps-first-card");

  await transcript.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(transcript.getByText("2 of 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "proposal-steps-second-card");

  await transcript.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(transcript.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(transcript.getByText("updating your bots.").first()).toBeVisible();
});
