import { expect, test } from "@playwright/test";
import { captureScreenshot, rpc, signupToOnboarding } from "./helpers";

// The whole first run in Portuguese, in both themes, ending on Home with the team it built.
test.use({ locale: "pt-BR" });

for (const theme of ["light", "dark"] as const) {
  test(`the first run reads in pt-BR and ends on Home with a team (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signupToOnboarding(page, `flow-${theme}-${Date.now()}@corvo.test`, "password12", "Flow");
    const next = page.getByRole("button", { name: /^(Continuar|Pular)$/ }).first();
    const rail = page.getByTestId("onboarding-rail");
    const preview = page.getByTestId("workspace-preview");

    await expect(page).toHaveURL(/\/onboarding\/workspace$/);
    await expect(rail).toContainText(/Faltam \d+ etapas/);
    await expect(page.getByTestId("onboarding-narration")).toContainText("Sou o Rook");
    await page.getByRole("textbox").first().fill("Greenflow");
    await expect(preview.getByTestId("preview-name")).toHaveText("Greenflow");
    await captureScreenshot(page, testInfo, `01-workspace-${theme}`);
    await next.click();

    await expect(page).toHaveURL(/\/onboarding\/business$/);
    await expect(rail).toContainText("Greenflow");
    await page.getByRole("button", { name: "Agência", exact: true }).click();
    await page.getByLabel("Em uma frase").fill("Cuidamos do marketing de clínicas");
    await captureScreenshot(page, testInfo, `02-business-${theme}`);
    await next.click();

    await expect(page).toHaveURL(/\/onboarding\/you$/);
    await expect(rail).toContainText("Agência");
    await page.getByRole("button", { name: "Vendas", exact: true }).click();
    await captureScreenshot(page, testInfo, `03-you-${theme}`);
    await next.click();

    await expect(page).toHaveURL(/\/onboarding\/start$/);
    await expect(page.getByTestId("team-suggestion")).toBeVisible();
    await expect(preview).toContainText("Agentes");
    await captureScreenshot(page, testInfo, `04-team-${theme}`);
    await next.click();

    await expect(page).toHaveURL(/\/onboarding\/bot$/);
    await captureScreenshot(page, testInfo, `05-first-bot-${theme}`);
    await next.click();

    await expect(page).toHaveURL(/\/onboarding\/invite$/);
    await captureScreenshot(page, testInfo, `06-invite-${theme}`);
    await page.getByRole("button", { name: "Pular" }).click();

    await page.waitForURL(/\/app\/home$/, { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite), Flow$/ }),
    ).toBeVisible();
    await expect(page.getByTestId("home-composer")).toBeVisible();
    await expect(page.getByTestId("home-waiting")).toBeVisible();
    await expect(page.getByTestId("home-working")).toBeVisible();
    await expect(page.getByTestId("home-routines")).toBeVisible();
    await captureScreenshot(page, testInfo, `07-home-${theme}`);

    const answers = await rpc<{ answers: { business: { kind: string } | null; areas: string[] } }>(
      page,
      "onboarding/progress",
      {},
    );
    expect(answers.answers.business?.kind).toBe("agency");
    expect(answers.answers.areas).toEqual(["sales"]);
    const bots = await rpc<unknown[]>(page, "bots/list", {});
    expect(bots.length).toBeGreaterThan(1);
  });
}

test("a step finished on another device is not asked again", async ({ page }) => {
  await signupToOnboarding(page, `resume-${Date.now()}@corvo.test`, "password12", "Resume");
  await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
  await page.evaluate(async () => {
    for (const step of ["workspace", "business", "you", "start"]) {
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

test("Enter continues and every step can be skipped", async ({ page }) => {
  await signupToOnboarding(page, `enter-${Date.now()}@corvo.test`, "password12", "Enter");
  await expect(page).toHaveURL(/\/onboarding\/workspace$/);
  await page.getByRole("textbox").first().press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/business$/);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/you$/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/business$/);
});
