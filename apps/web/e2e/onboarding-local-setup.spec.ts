import { expect, test } from "@playwright/test";
import { captureScreenshot, signup } from "./helpers";

test.afterEach(async ({ page }) => {
  // Finish intercepted responses before the browser context is disposed.
  await page.unrouteAll({ behavior: "wait" });
});

test("onboarding shows a found local server and continues in one click", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({ response, json: { json: { ...body.json, needsModel: true } } });
  });
  await page.route("**/rpc/models/localSetup", (route) =>
    route.fulfill({
      json: {
        json: {
          enabled: true,
          checking: false,
          checkedAt: 1,
          options: [
            {
              id: "server:11434",
              kind: "server",
              label: "Ollama",
              provider: "openai-compatible",
              models: ["fake-model", "other-model"],
              modelId: "fake-model",
              backgroundModelId: null,
              testable: true,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/rpc/models/testLocal", (route) =>
    route.fulfill({ json: { json: { ok: true, ms: 1400 } } }),
  );
  await page.route("**/rpc/models/useLocal", (route) =>
    route.fulfill({ json: { json: { ok: true } } }),
  );

  const stamp = Date.now();
  await signup(page, `local-setup-${stamp}@corvo.test`, "password12", "Local setup");

  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Ollama" })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Model" })).toContainText("fake-model");
  await page.getByRole("button", { name: "Test Ollama" }).click();
  await expect(page.getByText("Answered in 1.4 s")).toBeVisible();
  await captureScreenshot(page, testInfo, "onboarding-local-setup");

  const used = page.waitForRequest("**/rpc/models/useLocal");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  expect((await used).postDataJSON()).toMatchObject({
    json: { optionId: "server:11434", modelId: "fake-model" },
  });
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeHidden();
});

test("onboarding offers to sign in to an installed coding-agent CLI", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({ response, json: { json: { ...body.json, needsModel: true } } });
  });
  await page.route("**/rpc/models/localSetup", (route) =>
    route.fulfill({
      json: {
        json: {
          enabled: true,
          checking: false,
          checkedAt: 1,
          options: [],
          cliEngines: [
            {
              id: "claude",
              state: "signed_out",
              version: "2.5.0",
              models: [],
              checkedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    }),
  );
  await page.route("**/rpc/engines/setupState", (route) =>
    route.fulfill({
      json: { json: [{ id: "claude", installable: true, signIn: "terminal" }] },
    }),
  );

  const stamp = Date.now();
  await signup(page, `local-cli-${stamp}@corvo.test`, "password12", "Local CLI");

  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible();
  await expect(page.getByText("Claude Code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "onboarding-local-cli");
});
