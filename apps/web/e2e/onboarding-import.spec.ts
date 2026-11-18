import type { Bot } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, rpc, signupToOnboarding } from "./helpers";

test.use({ locale: "pt-BR" });

// A space exported from a local Rook: its routine is pinned to a CLI engine the cloud lacks.
const spaceFile = {
  version: 1,
  kind: "space",
  exportedAt: "2026-01-01T00:00:00.000Z",
  bots: [
    {
      bot: { name: "Ana", title: "Suporte", description: "", instructions: "Seja gentil." },
      memory: [],
      routines: [
        {
          name: "Resumo local",
          prompt: "Resuma a semana",
          crons: ["0 9 * * 1"],
          timezone: "UTC",
          modelProvider: "cli-engine",
          modelId: "claude/sonnet",
        },
      ],
      files: [],
    },
  ],
  memory: [],
  skills: [],
};

for (const theme of ["light", "dark"] as const) {
  test(`a Rook file imported while creating the account lands with its agents (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signupToOnboarding(
      page,
      `import-${theme}-${Date.now()}@corvo.test`,
      "password12",
      "Mover",
    );
    await expect(page).toHaveURL(/\/onboarding\/workspace$/);
    for (const step of ["business", "you", "start"]) {
      await page
        .getByRole("button", { name: /^(Continuar|Pular)$/ })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`/onboarding/${step}$`));
    }
    await expect(page.getByRole("heading", { name: "Seu time" })).toBeVisible();
    await page.getByRole("button", { name: "Importar" }).click();
    await expect(page.getByRole("button", { name: "ChatGPT" })).toBeVisible();
    await captureScreenshot(page, testInfo, `import-sources-${theme}`);

    await page.getByTestId("import-rook-file").setInputFiles({
      name: "space.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spaceFile)),
    });
    const preview = page.getByTestId("app-import-preview");
    await expect(preview.getByText("Ana")).toBeVisible();
    await expect(preview.getByText("Resumo local")).toBeVisible();
    await captureScreenshot(page, testInfo, `import-preview-${theme}`);

    await page.getByRole("button", { name: "Importar", exact: true }).click();
    await expect(page.getByTestId("imported-agents").getByText("Ana")).toBeVisible();
    await captureScreenshot(page, testInfo, `import-done-${theme}`);

    const bots = await rpc<Bot[]>(page, "bots/list", {});
    const ana = bots.find((bot) => bot.name === "Ana");
    expect(ana).toBeTruthy();
    const routines = await rpc<{ active: boolean; modelProvider: string | null }[]>(
      page,
      "routines/list",
      { botId: ana?.id },
    );
    expect(routines).toEqual([expect.objectContaining({ active: false, modelProvider: null })]);

    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page).toHaveURL(/\/onboarding\/(bot|model)$/);
  });
}
