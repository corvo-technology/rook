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
