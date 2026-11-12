import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1500, height: 700 } });

for (const theme of ["light", "dark"]) {
  test(`a card shows what its agent is doing while it works (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/tasks-live.html?theme=${theme}&locale=en`);
    const step = page.getByTestId("card-step");
    await expect(step).toHaveCount(1);
    await expect(page.getByTestId("board-card-t2")).toContainText("Searching the web");
    await expect(page.getByTestId("board-card-t1")).not.toContainText("Searching the web");
    await captureScreenshot(page, testInfo, `tasks-live-${theme}`);
  });
}
