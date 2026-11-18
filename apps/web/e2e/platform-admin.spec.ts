import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1280, height: 960 }, locale: "pt-BR" });

const config = {
  tiers: [
    {
      key: "starter",
      name: "Parceiro Inicial",
      prices: {
        BRL: { priceMinor: 100_000, includedCredits: 20_000 },
        USD: { priceMinor: 20_000, includedCredits: 20_000 },
      },
    },
    {
      key: "pro",
      name: "Parceiro Pro",
      prices: {
        BRL: { priceMinor: 400_000, includedCredits: 90_000 },
        USD: { priceMinor: 80_000, includedCredits: 90_000 },
      },
    },
  ],
  costs: {
    models: {
      "claude-sonnet": { inputPer1MMicros: 3_000_000, outputPer1MMicros: 15_000_000 },
      "gpt-mini": { inputPer1MMicros: 400_000, outputPer1MMicros: 1_600_000 },
    },
    voiceMinuteMicros: 90_000,
    computerMinuteMicros: 12_000,
    storageGbMonthMicros: 20_000,
  },
  margins: {
    tokensBps: 3000,
    perModelBps: { "gpt-mini": 5000 },
    voiceBps: 3500,
    computerMinuteBps: 4000,
    storageBps: 3000,
  },
  storageAllowanceGb: 5,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};

const partners = [
  {
    id: "p1",
    slug: "prontu",
    name: "Prontu",
    mode: "embedded",
    plan: "pro",
    activeCustomers: 42,
    fundBalanceCredits: 14_500,
    fundPercent: 64,
    chargedCredits: 61_000,
    costCredits: 40_000,
  },
  {
    id: "p2",
    slug: "greenbarber",
    name: "GreenBarber",
    mode: "embedded",
    plan: "starter",
    activeCustomers: 18,
    fundBalanceCredits: 900,
    fundPercent: 8,
    chargedCredits: 20_000,
    costCredits: 23_500,
  },
  {
    id: "p3",
    slug: "indicacao",
    name: "Indicação exemplo",
    mode: "referral",
    plan: null,
    activeCustomers: 3,
    fundBalanceCredits: 0,
    fundPercent: null,
    chargedCredits: 0,
    costCredits: null,
  },
];

const leads = [
  {
    id: "l1",
    name: "Bia Souza",
    company: "Bia Sistemas",
    email: "bia@example.test",
    whatsapp: "+55 11 90000-0000",
    website: "https://bia.example.test",
    partnerType: "embedded",
    country: "Brasil",
    customers: "50-200",
    message: "Atendemos salões e queremos o assistente dentro do nosso app.",
    status: "pending",
    createdAt: "2026-11-03T10:00:00.000Z",
  },
];

// Answers each platform call the way the API would, whatever the usage typed.
async function answer(page: Page) {
  await page.route("**/rpc/platform/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/rpc\/platform\//, "");
    const body = route.request().postDataJSON() as { json?: { usage?: { models: unknown[] } } };
    const usage = body?.json?.usage;
    const json =
      path === "partnerPricing/get"
        ? {
            version: 3,
            config,
            createdAt: "2026-11-01T12:00:00.000Z",
            effectiveAt: "2026-11-01T12:00:00.000Z",
          }
        : path === "partnerPricing/history"
          ? [
              {
                version: 4,
                createdAt: "2026-11-05T12:00:00.000Z",
                effectiveAt: "2026-12-01T00:00:00.000Z",
                status: "scheduled",
              },
              {
                version: 3,
                createdAt: "2026-11-01T12:00:00.000Z",
                effectiveAt: "2026-11-01T12:00:00.000Z",
                status: "live",
              },
              {
                version: 2,
                createdAt: "2026-10-01T12:00:00.000Z",
                effectiveAt: "2026-10-01T12:00:00.000Z",
                status: "past",
              },
            ]
          : path === "partnerLeads/list"
            ? leads
            : path === "waitlist/list"
              ? []
              : path === "partners/list"
                ? partners
                : path === "partnerPricing/simulate"
                  ? {
                      creditsPerCustomer: usage?.models.length ? 310 : 0,
                      costPerCustomer: {
                        modelsMicros: usage?.models.length ? 1_800_000 : 0,
                        infraMicros: 900_000,
                      },
                      marginPerCustomerMicros: 620_000,
                      customersSupported: 64,
                      fund: { creditsNeeded: 3100, covered: true, shortfallCredits: 0 },
                      totalMarginMicros: 6_200_000,
                      planMarginMicros: null,
                    }
                  : [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ json }) });
  });
}

const url = (section: string, theme: string) =>
  `/e2e/fixtures/platform-admin.html?section=${section}&theme=${theme}`;

for (const theme of ["light", "dark"] as const) {
  test(`Preços e margens shows the live version and its numbers (${theme})`, async ({
    page,
  }, testInfo) => {
    await answer(page);
    await page.goto(url("pricing", theme));
    await expect(page.getByTestId("platform-pricing")).toContainText("Versão 3 em vigor desde");
    await expect(page.getByTestId("platform-pricing")).toContainText(
      "Modelos próprios do cliente nunca são cobrados",
    );
    await expect(page.getByLabel("Parceiro Pro BRL Preço mensal")).toHaveValue("4000");
    const publish = page.getByRole("button", { name: "Publicar versão 4" });
    await expect(publish).toBeDisabled();
    await page.getByLabel("Voz Margem (%)").fill("40");
    await expect(publish).toBeEnabled();
    await captureScreenshot(page, testInfo, `platform-pricing-${theme}`);
  });

  test(`Simulador answers as the usage changes (${theme})`, async ({ page }, testInfo) => {
    await answer(page);
    await page.goto(url("simulator", theme));
    const simulator = page.getByTestId("platform-simulator");
    await expect(simulator).toContainText("Clientes que o fundo aguenta");
    await expect(simulator.getByText("310", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("platform-breakdown")).toContainText("Margem do Rook");
    await captureScreenshot(page, testInfo, `platform-simulator-${theme}`);
  });

  test(`Parceiros marks the partner that cost more than it paid (${theme})`, async ({
    page,
  }, testInfo) => {
    await answer(page);
    await page.goto(url("partners", theme));
    await expect(page.getByTestId("platform-partner-prontu")).toContainText("Embutido");
    await expect(
      page.getByTestId("platform-partner-greenbarber").locator("[data-negative]"),
    ).toBeVisible();
    await expect(
      page.getByTestId("platform-partner-prontu").locator("[data-negative]"),
    ).toHaveCount(0);
    await captureScreenshot(page, testInfo, `platform-partners-${theme}`);
  });
}

test("Candidaturas de parceiro opens the form to approve one", async ({ page }, testInfo) => {
  await answer(page);
  await page.goto(url("applications", "light"));
  await expect(page.getByTestId("platform-leads")).toContainText("Bia Sistemas");
  await page.getByRole("button", { name: "Aprovar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Slug")).toHaveValue("bia-sistemas");
  await expect(dialog.getByLabel("País")).toHaveValue("BR");
  await captureScreenshot(page, testInfo, "platform-applications-light");
});
