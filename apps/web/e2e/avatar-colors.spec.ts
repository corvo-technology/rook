import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 700, height: 1000 } });

for (const theme of ["light", "dark"]) {
  test(`a color of one's own is chosen in Avatar Studio and worn by the chick (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/avatar-colors.html?theme=${theme}`);
    const picker = page.getByTestId("picker");
    const swatches = picker.getByTestId("avatar-studio-colors").getByRole("button");
    await expect(swatches).toHaveCount(10);
    await expect(picker.getByRole("button", { name: "Color #3B82F6" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await picker.getByLabel("Custom color").fill("#14b8a6");
    // The choice is kept once the drag settles, and then no swatch is marked as worn.
    await expect(page.getByTestId("worn")).toContainText("#14B8A6");
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(picker.locator("[data-custom-color]")).toHaveText("#14B8A6");

    // The color is worn at every size, however light or dark it is.
    await expect(page.getByTestId("own-colors").locator("[data-mascot]")).toHaveCount(28);
    // The engine draws the rook: alive (a canvas) at the largest size, a still picture below it.
    await expect(page.getByTestId("own-colors").locator("[data-mascot] canvas")).toHaveCount(7);
    await expect(page.getByTestId("own-colors").locator("[data-mascot] svg")).toHaveCount(21);
    await captureScreenshot(page, testInfo, `avatar-colors-${theme}`);

    await picker.getByRole("button", { name: "Color #EAB308" }).click();
    await expect(picker.locator("[data-custom-color]")).toHaveCount(0);
    await expect(picker.getByRole("button", { name: "Color #EAB308" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
}
