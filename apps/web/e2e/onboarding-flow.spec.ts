import { expect, test } from "@playwright/test";
import { captureScreenshot, signupToOnboarding } from "./helpers";

// The whole first run in Portuguese, in both themes, ending in the Chief's chat with a first task.
test.use({ locale: "pt-BR" });

for (const theme of ["light", "dark"] as const) {
  test(`the first run reads in pt-BR and ends in a working chat (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signupToOnboarding(page, `flow-${theme}-${Date.now()}@corvo.test`, "password12", "Flow");
    const next = page.getByRole("button", { name: /^(Continuar|Pular)$/ }).first();

    await expect(page).toHaveURL(/\/onboarding\/workspace$/);
    await captureScreenshot(page, testInfo, `01-workspace-${theme}`);
    await next.click();

    await expect(page.getByRole("heading", { name: "Como quer começar?" })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding\/start$/);
    await expect(page.getByRole("button", { name: "Uma equipe pronta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Só o Chief" })).toBeVisible();
    await captureScreenshot(page, testInfo, `02-start-${theme}`);
    await page.getByRole("button", { name: "Só o Chief" }).click();
    await next.click();

    // The first bot, then the optional invitations.
    await expect(page).toHaveURL(/\/onboarding\/bot$/);
    await captureScreenshot(page, testInfo, `03-first-bot-${theme}`);
    await next.click();

    await expect(page.getByRole("heading", { name: "Convide sua equipe" })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding\/invite$/);
    await captureScreenshot(page, testInfo, `04-invite-${theme}`);
    await page.getByRole("button", { name: "Pular" }).click();

    await page.waitForURL(/\/app\//, { timeout: 20_000 });
    await expect(
      page.getByRole("textbox").filter({ hasText: "Apresente-se e sugira o que devemos fazer" }),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, `05-first-chat-${theme}`);
  });
}

test("a step finished on another device is not asked again", async ({ page }) => {
  await signupToOnboarding(page, `resume-${Date.now()}@corvo.test`, "password12", "Resume");
  await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
  await page.evaluate(async () => {
    for (const step of ["workspace", "start"]) {
      await fetch("/rpc/onboarding/stepDone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { step } }),
      });
    }
    sessionStorage.clear();
  });
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/onboarding\/bot$/);
});
