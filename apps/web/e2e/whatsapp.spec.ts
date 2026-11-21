import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

// The E2E server is not a desktop engine, so the linked-number transport is off there: the
// screen is exercised against stubbed routes, the way the voice spec models a catalog.
const NUMBER = {
  id: "inst-1",
  number: "+•••••••0100",
  botId: "bot-1",
  botName: "Rook",
  status: "active",
  paused: false,
  mode: "service",
  visitorConnectors: [] as string[],
};

test("the Store links a WhatsApp number by QR and lists it", async ({ page }, testInfo) => {
  let linked = false;
  await page.route("**/rpc/messaging/whatsapp/numbers/list", (route) =>
    route.fulfill({
      json: { json: { available: true, numbers: linked ? [NUMBER] : [] } },
    }),
  );
  await page.route("**/rpc/messaging/whatsapp/link/start", (route) =>
    route.fulfill({ json: { json: { linkId: "link-1" } } }),
  );
  await page.route("**/rpc/messaging/whatsapp/link/status", (route) =>
    route.fulfill({
      json: {
        json: linked
          ? { state: "linked", number: NUMBER.number }
          : { state: "qr", qr: "2@example-qr-for-a-screenshot,AAAA,BBBB,CCCC" },
      },
    }),
  );

  await signup(page, `whatsapp-${Date.now()}@corvo.test`, "password12", "WhatsApp");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Store", exact: true }).click();

  // WhatsApp is one line in the list; its numbers and the way to add one are on its own screen.
  const row = page.getByTestId("whatsapp-numbers");
  await expect(row.getByText("WhatsApp", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "whatsapp-store-list");
  await row.click();

  const screen = page.getByTestId("whatsapp-app");
  await expect(screen.getByText(/official API/)).toHaveCount(0);
  await screen.getByRole("button", { name: "Add number", exact: true }).click();

  const dialog = page.getByTestId("whatsapp-link");
  await expect(
    dialog.getByText("This uses WhatsApp without the official API.", { exact: false }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "whatsapp-link-choose");
  await dialog.getByRole("button", { name: "Show QR code" }).click();
  await expect(dialog.getByRole("img", { name: "QR code" })).toBeVisible();
  await captureScreenshot(page, testInfo, "whatsapp-link-qr");

  linked = true;
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  await expect(screen.getByText(NUMBER.number)).toBeVisible();
  await expect(screen.getByRole("button", { name: `More ${NUMBER.number}` })).toBeVisible();
  await captureScreenshot(page, testInfo, "whatsapp-number-linked");
});
