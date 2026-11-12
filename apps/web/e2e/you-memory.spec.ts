import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 760, height: 1100 } });
const url = (theme: string) => `/e2e/fixtures/you-memory.html?theme=${theme}&locale=en`;

for (const theme of ["light", "dark"]) {
  test(`Memory shows what agents know about you, with suggestions to save (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(url(theme));

    // A suggestion waits for Save or Discard; what is known is listed apart.
    const waiting = page.getByTestId("you-new");
    await expect(waiting).toContainText("Runs a small bakery in Lisbon");
    await expect(page.getByTestId("you-list")).toContainText("Allergic to peanuts");
    // Not confirmed for a long time: asked about, still in the prompt until decided.
    await expect(page.getByTestId("you-stale")).toContainText("Works from the Porto office");
    // The card an agent leaves in a conversation offers the same two answers.
    await expect(
      page.getByTestId("card-waiting").getByRole("button", { name: "Save" }),
    ).toBeVisible();
    await captureScreenshot(page, testInfo, `you-memory-${theme}`);

    await waiting.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("you-list")).toContainText("Runs a small bakery in Lisbon");
  });
}

test("a person teaches something, forgets it, and deletes it for good", async ({ page }) => {
  await page.goto(url("light"));
  const field = page.getByRole("textbox", { name: "Teach something about you" });
  await field.fill("Takes the 8:15 train");
  await field.press("Enter");
  await expect(page.getByTestId("you-list")).toContainText("Takes the 8:15 train");

  await page
    .getByTestId("you-list")
    .getByRole("listitem")
    .filter({ hasText: "Takes the 8:15 train" })
    .getByRole("button", { name: "Forget" })
    .click();
  const forgotten = page.getByTestId("you-forgotten");
  await forgotten.locator("summary").click();
  await expect(forgotten).toContainText("Takes the 8:15 train");
  await forgotten
    .getByRole("listitem")
    .filter({ hasText: "Takes the 8:15 train" })
    .getByRole("button", { name: "Delete for good" })
    .click();
  await expect(forgotten).not.toContainText("Takes the 8:15 train");
});
