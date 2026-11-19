import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1280, height: 800 }, locale: "pt-BR" });

/**
 * The launcher on a fictional partner's page. The partner's session route is answered here, and
 * the frame's address is served from fixtures, so no backend is needed; the page runs the real
 * sdk.js and the real chat components.
 */
async function openHost(page: Page, query = "") {
  await page.route("**/demo/session", (route) => route.fulfill({ json: { code: "demo-code" } }));
  await page.route("**/embed", (route) =>
    route.fulfill({
      status: 302,
      headers: { location: "/e2e/fixtures/launcher-frame.html" },
    }),
  );
  await page.goto(`/e2e/fixtures/launcher-host.html${query}`);
}

test("the quick-ask popover shows the context, suggestions and a way to the full chat", async ({
  page,
}, testInfo) => {
  await openHost(page);
  await page.getByRole("button", { name: "Chief" }).click();
  const popover = page.getByRole("dialog", { name: "Chief" }).first();
  await expect(popover.getByText("Carlos Souza")).toBeVisible();
  await expect(popover.getByPlaceholder("Pergunte ou peça")).toBeFocused();
  await expect(popover.getByRole("button", { name: "Esse cliente está sumido?" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Abrir conversa completa" })).toBeVisible();
  await captureScreenshot(page, testInfo, "launcher-popover");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(page.getByRole("button", { name: "Chief" })).toBeFocused();
});

test("Ctrl+J opens and closes the launcher", async ({ page }) => {
  await openHost(page);
  await page.keyboard.press("Control+j");
  await expect(page.getByPlaceholder("Pergunte ou peça")).toBeVisible();
  await page.keyboard.press("Control+j");
  await expect(page.getByPlaceholder("Pergunte ou peça")).toBeHidden();
});

test("the panel shows the chat with the page context, and an action runs only after Confirm", async ({
  page,
}, testInfo) => {
  await openHost(page);
  await page.getByRole("button", { name: "Chief" }).click();
  await page.getByRole("button", { name: "Abrir conversa completa" }).click();
  const frame = page.frameLocator("iframe");
  await expect(frame.getByText("Vendo: Carlos Souza")).toBeVisible();
  await expect(frame.getByTestId("host-action-card")).toContainText("Abrir na agenda");
  // Nothing has happened in the partner's page yet.
  await expect(page.getByTestId("host-log")).toHaveText("");
  await captureScreenshot(page, testInfo, "launcher-panel");
  await frame.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByTestId("host-log")).toHaveText("action:open_agenda");
  await expect(frame.getByTestId("host-action-card")).toContainText("Concluído");
});

test("a suggestion opens the chat and sends it as the person's message", async ({ page }) => {
  await openHost(page);
  await page.getByRole("button", { name: "Chief" }).click();
  await page.getByRole("button", { name: "Resumo das últimas visitas" }).click();
  await expect(page.frameLocator("iframe").getByText("Resumo das últimas visitas")).toBeVisible();
});

test("on a phone the panel is a bottom sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHost(page);
  await page.getByRole("button", { name: "Chief" }).click();
  await page.getByRole("button", { name: "Abrir conversa completa" }).click();
  const panel = page.getByRole("dialog", { name: "Chief" }).last();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBe(390);
  expect(box?.y).toBeGreaterThan(100);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await captureScreenshot(page, testInfo, "launcher-sheet");
});

test("the launcher hides itself when the session is refused", async ({ page }) => {
  await page.route("**/demo/session", (route) => route.fulfill({ status: 403, body: "no" }));
  await page.goto("/e2e/fixtures/launcher-host.html");
  // The session is prepared as soon as the browser is idle; refused, the button goes away.
  await expect(page.getByRole("button", { name: "Chief" })).toBeHidden();
});
