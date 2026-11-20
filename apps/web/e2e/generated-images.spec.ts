import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("generated images show as one row with a lightbox and a way to ask for more", async ({
  page,
}, testInfo) => {
  await page.goto("/e2e/fixtures/generated-images.html");
  const pictures = page.getByRole("img", { name: /lighthouse-\d\.png/ });
  await expect(pictures).toHaveCount(3);
  for (const picture of await pictures.all()) await expect(picture).toBeVisible();
  await captureScreenshot(page, testInfo, "generated-images-row");

  // An action on a picture asks the agent with that picture as the reference.
  await page.getByRole("button", { name: "More image actions" }).nth(1).click();
  await page.getByRole("menuitem", { name: "Variations" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "More image actions" }).nth(2).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  expect(
    await page.evaluate(() => (window as unknown as { imageAsks: unknown }).imageAsks),
  ).toEqual([
    { artifactId: "generated-2", ask: "variations" },
    { artifactId: "generated-3", ask: "edit" },
  ]);

  // A click on the picture opens it large; Escape closes it.
  await page.getByRole("button", { name: "lighthouse-1.png" }).click();
  const dialog = page.getByRole("dialog", { name: "lighthouse-1.png" });
  await expect(dialog).toBeVisible();
  await captureScreenshot(page, testInfo, "generated-image-lightbox");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
