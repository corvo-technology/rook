import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("the whole sidebar scrolls on a laptop screen with many agents", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const stamp = Date.now();
  await signup(page, `sidebar-scroll-${stamp}@corvo.test`, "password12", "Sidebar Scroll");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  let lastId = "";
  for (let i = 1; i <= 22; i++) {
    const bot = await rpc<{ id: string }>(page, "bots/create", {
      name: `Scroll Agent ${String(i).padStart(2, "0")}`,
      title: "Proposals and scope",
      description: "",
      instructions: "",
      notifyOnFinish: true,
      computerMode: "team",
    });
    lastId = bot.id;
  }
  await page.reload();

  const sidebar = page.getByTestId("bots-sidebar");
  const scroller = sidebar.locator(".rk-scroll");
  await expect(sidebar.locator(`[data-roster-bot-id="${lastId}"]`)).toBeAttached();

  // The main nav lives inside the scroller, so the list gets all the height between header and footer.
  const box = await scroller.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(300);
  await expect(scroller.getByRole("navigation").first()).toBeVisible();

  // The role shows once per row, not again as a preview line.
  const row = sidebar.locator(`[data-roster-bot-id="${lastId}"]`);
  await expect(row.getByText("Proposals and scope")).toHaveCount(1);

  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeInViewport();
  await captureScreenshot(page, testInfo, "sidebar-scrolled-to-last-agent");
});
