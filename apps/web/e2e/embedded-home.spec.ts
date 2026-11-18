import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 960, height: 900 }, locale: "pt-BR" });

const PARTNERS = [
  { id: "prontu", chief: "Assistente Prontu", first: "Resumo da agenda de hoje" },
  { id: "greenbarber", chief: "Assistente GreenBarber", first: "Quem vem hoje?" },
  { id: "divellas", chief: "Assistente Divellas", first: "Quem vem hoje?" },
];

for (const partner of PARTNERS) {
  for (const theme of ["light", "dark"] as const) {
    test(`${partner.id} Home inside the host product (${theme})`, async ({ page }, testInfo) => {
      await page.goto(`/e2e/fixtures/embedded-home.html?partner=${partner.id}&theme=${theme}`);
      const tabs = page.getByTestId("embed-tabs");
      await expect(tabs).toContainText(partner.chief);
      await expect(tabs.getByRole("button")).toHaveText([
        "Início",
        "Conversas",
        "Tarefas",
        "Rotinas",
        "Agentes",
      ]);
      await expect(page.getByRole("heading", { name: "Bom dia, Ana" })).toBeVisible();
      await expect(page.getByTestId("embed-quick-actions")).toContainText(partner.first);
      await expect(page.getByTestId("partner-balance")).toContainText("R$ 18 de R$ 30 este mês");
      await expect(page.getByTestId("home-waiting")).toContainText("Esperando você");
      await expect(page.getByTestId("home-working")).toContainText("Trabalhando agora");
      // The host product's own scroll is the only one.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      await captureScreenshot(page, testInfo, `embedded-${partner.id}-${theme}`);
    });
  }
}

test("the balance warns at the threshold and when the plan lapsed", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/embedded-home.html?balance=low");
  await expect(page.getByTestId("partner-balance-note")).toHaveText("Acabando");
  await expect(page.getByTestId("partner-buy-more")).toHaveText("Comprar mais");
  await captureScreenshot(page, testInfo, "embedded-balance-low");
  await page.goto("/e2e/fixtures/embedded-home.html?balance=lapsed");
  await expect(page.getByTestId("partner-balance-note")).toHaveText("Plano inativo");
  await page.goto("/e2e/fixtures/embedded-home.html?balance=none");
  await expect(page.getByTestId("partner-balance")).toHaveCount(0);
});

test("a narrow frame keeps the tabs on one scrolling row", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/e2e/fixtures/embedded-home.html?partner=prontu&theme=light");
  await expect(page.getByTestId("embed-tab-home")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await captureScreenshot(page, testInfo, "embedded-prontu-narrow");
});
