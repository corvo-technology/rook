import type { Bot } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

const answer = JSON.stringify({
  name: "Sales Coach",
  role: "Coaches the sales team",
  instructions: "Be direct. Ask one question at a time.",
  conversation_starters: ["Review my pitch"],
  knowledge_files: ["playbook.pdf"],
  memory: ["Works in EMEA"],
  connections: ["HubSpot"],
  routines: [{ name: "Monday brief", prompt: "Summarise the week", schedule: "0 9 * * 1" }],
  api_key: "placeholder-never-imported",
});

test("an agent from another app is previewed, then imported with its routine paused", async ({
  page,
}, testInfo) => {
  await signup(page, `import-app-${Date.now()}@corvo.test`, "password12", "Importer");
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  await sidebar.getByRole("button", { name: "Actions for Personal" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const settings = page.getByTestId("settings-page");
  await settings.getByRole("button", { name: "Import from another app" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Answer" }).fill(`\`\`\`json\n${answer}\n\`\`\``);
  await dialog.getByRole("button", { name: "Preview" }).click();

  const preview = dialog.getByTestId("app-import-preview");
  await expect(preview.getByText("Sales Coach")).toBeVisible();
  await expect(preview.getByText("Monday brief")).toBeVisible();
  await expect(preview.getByText("playbook.pdf")).toBeVisible();
  await expect(preview.getByText("HubSpot")).toBeVisible();
  await expect(preview.getByText("placeholder-never-imported")).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await captureScreenshot(page, testInfo, `import-from-app-preview-${theme}`);
  }

  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByText(/^Added 1 agent/)).toBeVisible();

  const bots = await rpc<Bot[]>(page, "bots/list", {});
  const added = bots.find((bot) => bot.name === "Sales Coach");
  expect(added?.instructions).toBe("Be direct. Ask one question at a time.");
  const routines = await rpc<{ active: boolean }[]>(page, "routines/list", { botId: added?.id });
  expect(routines.map((routine) => routine.active)).toEqual([false]);
});
