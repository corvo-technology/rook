import { expect, test } from "@playwright/test";
import { captureScreenshot, signup } from "./helpers";

test.use({ locale: "pt-BR" });

for (const theme of ["light", "dark"] as const) {
  test(`Home greets, lists getting started and the live cards (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signup(page, `home-${theme}-${Date.now()}@corvo.test`, "password12", "Ana Souza");
    await page.goto("/app/home");

    await expect(
      page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite), Ana$/ }),
    ).toBeVisible();
    const checklist = page.getByTestId("home-checklist");
    await expect(checklist).toContainText(/Continue de onde parou · \d de 4/);
    await expect(checklist.getByRole("link", { name: "Criar uma rotina" })).toBeVisible();
    await expect(page.getByTestId("home-waiting")).toContainText("Esperando você");
    await expect(page.getByTestId("home-working")).toContainText("Trabalhando agora");
    await expect(page.getByTestId("home-routines")).toContainText("Próximas rotinas");
    await captureScreenshot(page, testInfo, `home-${theme}`);
  });
}

test("asking from Home starts the chat with the Chief", async ({ page }) => {
  await signup(page, `home-ask-${Date.now()}@corvo.test`, "password12", "Ask");
  await page.goto("/app/home");
  const composer = page.getByTestId("home-composer").getByRole("textbox");
  await composer.fill("Faça um resumo do dia");
  await composer.press("Enter");
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page).not.toHaveURL(/\/app\/home$/);
  await expect(page.getByTestId("transcript").getByText("Faça um resumo do dia")).toBeVisible();
});

test("the app opens on Home from the root address", async ({ page }) => {
  await signup(page, `home-root-${Date.now()}@corvo.test`, "password12", "Root");
  await page.goto("/");
  await page.waitForURL(/\/app\/home$/);
});
