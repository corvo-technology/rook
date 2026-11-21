import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const GIB = 1024 ** 3;

const plan = {
  plan: "team",
  computerSize: "medium",
  computers: { used: 2, limit: 3 },
  storage: { usedBytes: 86 * GIB, limitBytes: 100 * GIB },
  seats: {
    used: 7,
    included: 10,
    max: 15,
    extraPrice: { amount: 500, currency: "usd", interval: "month" },
  },
  plans: [
    {
      plan: "personal",
      computerSize: "small",
      computers: 1,
      storageBytes: 20 * GIB,
      seatsIncluded: 1,
      maxSeats: 1,
    },
    {
      plan: "team",
      computerSize: "medium",
      computers: 3,
      storageBytes: 100 * GIB,
      seatsIncluded: 10,
      maxSeats: 15,
    },
    {
      plan: "company",
      computerSize: "large",
      computers: 10,
      storageBytes: 500 * GIB,
      seatsIncluded: 25,
      maxSeats: 50,
    },
  ],
  canManage: true,
};

test("Usage shows storage against the plan, in light and dark", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `plan-usage-${stamp}@corvo.test`, "password12", `Plan usage ${stamp}`);
  await completeOnboarding(page);
  await page.route("**/rpc/usage/plan", (route) => route.fulfill({ json: { json: plan } }));

  await page.goto("/app/usage");
  const section = page.getByTestId("plan-usage");
  await expect(section.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(section.getByText("86 GB of 100 GB")).toBeVisible();
  await expect(section.getByText("2 of 3")).toBeVisible();
  await expect(section.getByText("7 of 15")).toBeVisible();
  await expect(section.getByText("4 CPU · 8 GB · 20 GB")).toBeVisible();
  await expect(section.getByRole("button", { name: "Upgrade" })).toBeVisible();

  await page.emulateMedia({ colorScheme: "light" });
  await captureScreenshot(page, testInfo, "usage-storage-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await captureScreenshot(page, testInfo, "usage-storage-dark");
  await page.emulateMedia({ colorScheme: "light" });

  // Under 80% there is nothing to upgrade for.
  plan.storage.usedBytes = 12 * GIB;
  await page.reload();
  await expect(page.getByTestId("plan-usage").getByText("12 GB of 100 GB")).toBeVisible();
  await expect(page.getByTestId("plan-usage").getByRole("button", { name: "Upgrade" })).toHaveCount(
    0,
  );
});

test("Usage leads with the money spent, on credits and on the user's own accounts", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `usage-spend-${stamp}@corvo.test`, "password12", `Usage spend ${stamp}`);
  await completeOnboarding(page);
  const cache = { input: 120_000, cacheRead: 880_000, cacheWrite: 40_000, output: 90_000 };
  const model = (name: string) => [{ provider: "openrouter", model: name, tokens: 600_000 }];
  const agent = (id: string, name: string, color: string, spendUsd: number, extra = {}) => ({
    id,
    name,
    color,
    tokens: 600_000,
    replies: 12,
    costUsd: spendUsd,
    spendUsd,
    cache,
    models: model("model-a"),
    ...extra,
  });
  await page.route("**/rpc/usage/overview", (route) =>
    route.fulfill({
      json: {
        json: {
          period: "month",
          from: "2026-11-01T00:00:00.000Z",
          to: "2026-11-15T12:00:00.000Z",
          tokens: 1_130_000,
          previousTokens: 900_000,
          replies: 36,
          costUsd: 12.4,
          cache,
          spend: { creditsUsd: 8, ownUsd: 4.4, ownEstimatedUsd: 4.4 },
          previousSpendUsd: 9.5,
          agents: [
            agent("a1", "Pia", "#10B981", 7.1, {
              failed: 2,
              failureKinds: { billing: 1, limit: 1 },
            }),
            agent("a2", "Nico", "#3B82F6", 4.2),
            agent("a3", "Ada", "#F59E0B", 1.1),
          ],
          accounts: [
            {
              provider: "openrouter",
              model: "model-a",
              funding: "credits",
              calls: 120,
              tokens: 800_000,
              spendUsd: 8,
              estimated: false,
              cache,
            },
            {
              provider: "openai-codex",
              model: "model-b",
              funding: "own",
              calls: 64,
              tokens: 330_000,
              spendUsd: 4.4,
              estimated: true,
              cache,
            },
          ],
          days: [
            {
              date: "2026-11-01",
              tokens: 200_000,
              agents: { a1: 200_000 },
              spendUsd: 2.1,
              agentSpendUsd: { a1: 2.1 },
            },
            {
              date: "2026-11-02",
              tokens: 500_000,
              agents: { a1: 300_000, a2: 200_000 },
              spendUsd: 6.3,
              agentSpendUsd: { a1: 3.5, a2: 2.8 },
            },
            {
              date: "2026-11-03",
              tokens: 430_000,
              agents: { a2: 230_000, a3: 200_000 },
              spendUsd: 4,
              agentSpendUsd: { a2: 3, a3: 1 },
            },
          ],
        },
      },
    }),
  );

  await page.goto("/app/usage");
  await expect(page.getByText("$12.40")).toBeVisible();
  await expect(page.getByText("Rook credits").first()).toBeVisible();
  await expect(page.getByText("≈ $4.40").first()).toBeVisible();
  const tokens = page.getByRole("region", { name: "Tokens" });
  await expect(tokens.getByText("Cache hit rate")).toBeVisible();
  await expect(tokens.getByText("85%")).toBeVisible();
  await page.getByRole("button", { name: "2 failed" }).click();
  await expect(page.getByText("Billing 1 · Limit reached 1")).toBeVisible();
  await expect(page.getByRole("region", { name: "By model" })).toContainText(
    "ChatGPT subscription",
  );
  await captureScreenshot(page, testInfo, "usage-spend");
});
