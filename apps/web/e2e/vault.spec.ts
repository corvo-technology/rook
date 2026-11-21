import type { VaultCredential } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("lists the credentials in the Vault and adds one without showing its value", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `vault-${stamp}@corvo.test`, "password12", "Vault");
  await completeOnboarding(page);

  const value = "e2e-fake-vault-value-1";
  const credentials: VaultCredential[] = [
    {
      id: "credential-1",
      name: "billing_api",
      origin: "https://api.example.test",
      auth: { type: "bearer" },
      scope: "personal",
      mine: true,
      canManage: true,
      botIds: [],
      createdAt: "2026-11-15T00:00:00.000Z",
      updatedAt: "2026-11-15T00:00:00.000Z",
      lastUsedAt: "2026-11-16T00:00:00.000Z",
    },
  ];
  await page.context().route("**/rpc/vault/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: credentials }),
    });
  });
  await page.context().route("**/rpc/vault/create", async (route) => {
    const { json } = route.request().postDataJSON() as { json: Record<string, unknown> };
    // The value goes up once, with the destination and who may use it.
    expect(json).toMatchObject({
      destination: { name: "reports", origin: "https://reports.example.test" },
      value,
      scope: "personal",
    });
    credentials.push({
      id: "credential-2",
      name: "reports",
      origin: "https://reports.example.test",
      auth: { type: "bearer" },
      scope: "personal",
      mine: true,
      canManage: true,
      botIds: [],
      createdAt: "2026-11-17T00:00:00.000Z",
      updatedAt: "2026-11-17T00:00:00.000Z",
      lastUsedAt: null,
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: credentials[1] }),
    });
  });

  await openUserSettings(page, "vault");
  const rows = page.getByTestId("vault-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("billing_api");
  await expect(rows.first()).toContainText("https://api.example.test");

  await page.getByTestId("vault-add").click();
  const sheet = page.getByTestId("vault-add-sheet");
  await sheet.getByTestId("vault-name").fill("reports");
  await sheet.getByTestId("vault-origin").fill("https://reports.example.test");
  await sheet.getByTestId("vault-value").fill(value);
  await sheet.getByTestId("vault-save").click();

  await expect(sheet).toBeHidden();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("reports");
  // The value is never shown again, anywhere on the page.
  await expect(page.getByText(value)).toHaveCount(0);
  expect(await page.content()).not.toContain(value);
  await captureScreenshot(page, testInfo, "vault-list");
});
