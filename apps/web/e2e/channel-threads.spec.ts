import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1180, height: 760 } });

for (const theme of ["light", "dark"]) {
  test(`a channel reads its replies in a thread beside it (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/channel-threads.html?theme=${theme}&working=2`);
    const main = page.locator("main").getByTestId("transcript");

    // The replies are not in the main column; the hand-off carries their footer.
    await expect(main.getByText("Draft is up: three short paragraphs and one image.")).toHaveCount(
      0,
    );
    await expect(main.getByText("Anything else you need from me today?")).toBeVisible();
    const footer = main.getByTestId("thread-footer");
    await expect(footer).toContainText("4 replies");
    await expect(footer).toHaveAttribute("aria-expanded", "false");

    // The working line names who is working, above the composer.
    await expect(page.getByTestId("working-line")).toHaveText("Chief and Bento are working…");

    await footer.focus();
    await footer.press("Enter");
    const panel = page.getByTestId("thread-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Thread" })).toBeVisible();
    await expect(footer).toHaveAttribute("aria-expanded", "true");
    await expect(
      panel.getByText("Draft is up: three short paragraphs and one image."),
    ).toBeVisible();
    await expect(panel.getByText("Make the opening shorter.")).toBeVisible();
    await expect(panel.getByRole("textbox", { name: "Reply" })).toBeFocused();
    await captureScreenshot(page, testInfo, `channel-thread-open-${theme}`);

    // A reply goes into the thread and is counted in its footer.
    await panel.getByRole("textbox", { name: "Reply" }).fill("Thanks, ship it.");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(panel.getByText("Thanks, ship it.")).toBeVisible();
    await expect(main.getByText("Thanks, ship it.")).toHaveCount(0);
    await expect(footer).toContainText("5 replies");

    // Escape closes it and focus returns to the footer that opened it.
    await panel.getByRole("textbox", { name: "Reply" }).press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(footer).toBeFocused();
  });
}

test("a thread reply can @mention an agent", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/channel-threads.html?theme=light&working=2");
  await page.getByTestId("thread-footer").press("Enter");
  const panel = page.getByTestId("thread-panel");
  const reply = panel.getByRole("textbox", { name: "Reply" });
  await reply.fill("@Le");
  await expect(page.getByTestId("mention-picker")).toBeVisible();
  await captureScreenshot(page, testInfo, "channel-thread-mention-picker");
  await panel.getByRole("option", { name: "@Leo" }).click();
  await expect(panel.getByTestId("mention-chip")).toHaveText("Leo");
  await reply.fill("check the numbers");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("@Leo check the numbers")).toBeVisible();
});

test("a message's hover actions open its thread, and many agents are counted", async ({ page }) => {
  await page.goto("/e2e/fixtures/channel-threads.html?theme=light&working=4");
  await expect(page.getByTestId("working-line")).toHaveText("4 agents are working…");
  const said = "On it. I am handing the draft to Bento and the numbers to Cora.";
  await page.getByText(said).hover();
  await page
    .locator("[data-message-id]")
    .filter({ hasText: said })
    .getByRole("button", { name: "Reply in thread" })
    .click();
  const panel = page.getByTestId("thread-panel");
  await expect(panel.getByText(said)).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Reply" })).toBeFocused();
});
