import type { Page, TestInfo } from "@playwright/test";
import { devices, test } from "@playwright/test";

// Record the desktop and iPhone layouts.
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
test.use({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});

async function openHomepage(page: Page, path = "/") {
  await page.goto(path);
  // The server-rendered preview is visible before its client listeners are ready.
  await page
    .locator('astro-island[component-export="ProductPreview"]:not([ssr])')
    .waitFor({ state: "attached" });
  // The preview types its request and is answered once it scrolls into view; wait for the answer.
  await page.getByTestId("product-preview").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /^(Approve|Aprovar)$/ }).waitFor({ state: "visible" });
  await page.evaluate(() => scrollTo(0, 0));
}

/** Visual record for the CI screenshot gallery. No content assertions. */
async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    scale: "css",
    path: screenshotPath,
  });
  await testInfo.attach(name, { contentType: "image/png", path: screenshotPath });
}

test("homepage screenshots", async ({ page }, testInfo) => {
  await openHomepage(page);
  await captureScreenshot(page, testInfo, "01-marketing-homepage");

  await openHomepage(page, "/pt/");
  await captureScreenshot(page, testInfo, "03-marketing-homepage-pt");

  await openHomepage(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.mouse.move(0, 0);
  await captureScreenshot(page, testInfo, "04-marketing-preview-approved");
});

test.describe("on an iPhone", () => {
  test.use(iPhone);

  test("homepage screenshot", async ({ page }, testInfo) => {
    await openHomepage(page);
    await captureScreenshot(page, testInfo, "02-marketing-homepage-iphone");
  });
});
