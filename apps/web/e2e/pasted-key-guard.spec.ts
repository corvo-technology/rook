import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

// A fake key with a real GitHub token's shape.
const FAKE_KEY = `ghp_${"aB3dE5gH7jK9mN1pQ".repeat(3).slice(0, 36)}`;

test("a pasted key is offered to the credential store instead of the chat", async ({
  page,
  context,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `pasted-key-${stamp}@corvo.test`, "password12", "Pasted Key");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  const botId = activeBotId(page);
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await expect(composer).toBeVisible();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((key) => navigator.clipboard.writeText(`deploy with ${key}`), FAKE_KEY);
  await composer.click();
  await page.keyboard.press("ControlOrMeta+v");

  const prompt = page.getByTestId("pasted-key-prompt");
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId("pasted-key-name")).toHaveValue("github-token");
  await captureScreenshot(page, testInfo, "pasted-key-prompt");

  // The draft with the key is never kept in browser storage.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(FAKE_KEY);

  await prompt.getByTestId("pasted-key-save").click();
  await expect(prompt).toHaveCount(0);
  await expect(composer).toHaveValue("deploy with $GITHUB_TOKEN");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(FAKE_KEY);

  // The key sits in the credential store, which never returns the value.
  const listed = await rpc<Array<Record<string, unknown>>>(page, "botSecrets/list", { botId });
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ name: "github-token", auth: { type: "command" } });
  expect(JSON.stringify(listed)).not.toContain(FAKE_KEY);

  // Nothing was posted to the chat.
  const history = await rpc<{ messages: unknown[] }>(page, "threads/messages", { botId });
  expect(JSON.stringify(history)).not.toContain(FAKE_KEY);

  // Sending anyway keeps the person in control: a second key can still go as typed.
  await composer.fill(`keep ${FAKE_KEY}`);
  await page.keyboard.press("Enter");
  await expect(prompt).toBeVisible();
  await page.getByTestId("pasted-key-send").click();
  await expect(prompt).toHaveCount(0);
  await expect(composer).toHaveValue("");
  await expect(page.getByText(`keep ${FAKE_KEY}`).first()).toBeVisible();
});
