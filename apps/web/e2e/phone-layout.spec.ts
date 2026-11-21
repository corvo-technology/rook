import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

// An iPhone-sized browser: touch, no hover, 390px wide.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const SCREENS = [
  { name: "agent-chat", path: "/app" },
  { name: "settings", path: "/settings" },
  { name: "team", path: "/app/team" },
  { name: "home", path: "/app/home" },
  { name: "board", path: "/app/board" },
  { name: "wiki", path: "/app/wiki" },
  { name: "usage", path: "/app/usage" },
  { name: "routines", path: "/app/routines" },
  { name: "store", path: "/app/store" },
  { name: "activity", path: "/app/activity" },
];

/** Polls, because a page settles a moment after it opens. */
async function expectNoHorizontalOverflow(page: Page, where: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
      message: `${where} scrolls sideways`,
    })
    .toBeLessThanOrEqual(0);
}

test("the main screens fit a phone and the composer controls do not overlap", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  await signup(page, `phone-${Date.now()}@corvo.test`, "password12", "Phone Layout");
  await completeOnboarding(page);
  await page.goto("/app");
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await expect(composer).toBeVisible({ timeout: 20_000 });

  // The text field is 16px so iOS Safari does not zoom the page when it is focused.
  expect(
    await composer.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);

  const bar = page.getByTestId("composer-bar");
  const send = page.getByRole("button", { name: "Send", exact: true });
  const barBox = (await bar.boundingBox())!;
  const sendBox = (await send.boundingBox())!;
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(390);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(barBox.x + barBox.width);
  // The model control, when there is one, sits beside the text field instead of over it.
  const modelControl = page.locator('[id^="message-model-"]');
  if (await modelControl.count()) {
    const field = (await composer.boundingBox())!;
    const model = (await modelControl.boundingBox())!;
    expect(field.x + field.width).toBeLessThanOrEqual(model.x + 1);
  }
  await composer.focus();
  await expectNoHorizontalOverflow(page, "the composer with focus");
  await captureScreenshot(page, testInfo, "phone-chat-composer");

  // The chat name is readable: it is not squeezed down to an initial.
  const name = page.getByTestId("bot-settings-trigger");
  const nameBox = (await name.boundingBox())!;
  expect(nameBox.width).toBeGreaterThan(110);
  await composer.blur();

  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(page.getByTestId("shell-root").or(page.locator("main")).first()).toBeVisible();
    // Lets the page's data arrive so the layout measured is the finished one.
    await page.waitForTimeout(2_000);
    await expectNoHorizontalOverflow(page, screen.name);
    await captureScreenshot(page, testInfo, `phone-${screen.name}`);
  }

  await page.goto("/app");
  await page.getByRole("button", { name: "Open navigation" }).tap();
  await expect(page.getByTestId("bots-sidebar")).toBeVisible();
  await expectNoHorizontalOverflow(page, "the sidebar drawer");
  await captureScreenshot(page, testInfo, "phone-sidebar");
});

test("with a model to pick, the composer keeps the placeholder, the model and Send apart", async ({
  page,
}, testInfo) => {
  await signup(page, `phone-model-${Date.now()}@corvo.test`, "password12", "Phone Model");
  await completeOnboarding(page);
  await rpc(page, "models/connect", {
    provider: "openrouter",
    apiKey: "fake-openrouter-key",
    modelId: "anthropic/claude-sonnet-4.5",
  });
  await page.goto("/app");
  const chip = page.locator('[id^="message-model-"]');
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await composer.fill("");
  const bar = (await page.getByTestId("composer-bar").boundingBox())!;
  const field = (await composer.boundingBox())!;
  const model = (await chip.boundingBox())!;
  const send = (await page.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
  expect(field.x + field.width).toBeLessThanOrEqual(model.x + 1);
  expect(model.x + model.width).toBeLessThanOrEqual(send.x);
  expect(send.x + send.width).toBeLessThanOrEqual(bar.x + bar.width);
  expect(bar.x + bar.width).toBeLessThanOrEqual(390);
  await composer.focus();
  await expectNoHorizontalOverflow(page, "the composer with a model to pick");
  await captureScreenshot(page, testInfo, "phone-composer-model");
});
