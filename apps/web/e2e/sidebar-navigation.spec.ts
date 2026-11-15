import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

/** Whatever the nav opens, the space header, the nav and the channel and agent lists stay put. */
async function expectSidebarIntact(page: Page) {
  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByTestId("sidebar-nav")).toBeVisible();
  await expect(sidebar.getByText("Chief").first()).toBeVisible();
  await expect(sidebar.getByText("Product").first()).toBeVisible();
  await expect(page.getByTestId("app-rail")).toHaveCount(0);
}

test("every place in the sidebar opens in the main pane and leaves the lists in place", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signup(page, `sidebar-nav-${Date.now()}@corvo.test`, "password12", "Sidebar Nav");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!activity|team|approvals)[^/]+$/);
  const chiefId = activeBotId(page);
  await rpc(page, "groups/create", { name: "Product", botIds: [chiefId] });
  await page.reload();
  // Show every place; a new account starts with a shorter nav.
  const showAll = page.getByRole("button", { name: "Show everything", exact: true });
  if (await showAll.isVisible().catch(() => false)) await showAll.click();

  const nav = page.getByTestId("sidebar-nav");
  const pane = page.getByTestId("shell-page");
  await expectSidebarIntact(page);
  await expect(nav.getByTestId("sidebar-home")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("bot-settings-trigger")).toContainText("Chief");
  await captureScreenshot(page, testInfo, "nav-home");

  const places: Array<{ id: string; url: RegExp; heading?: string; shot: string }> = [
    { id: "approvals", url: /\/app\/approvals$/, heading: "Approvals", shot: "nav-approvals" },
    { id: "tasks", url: /\/app\/board$/, heading: "Tasks", shot: "nav-tasks" },
    { id: "routines", url: /\/app\/routines$/, shot: "nav-routines" },
    { id: "activity", url: /\/app\/activity$/, heading: "Activity", shot: "nav-activity" },
    { id: "team", url: /\/app\/team$/, heading: "Team", shot: "nav-team" },
  ];
  for (const place of places) {
    await nav.getByTestId(`sidebar-${place.id}`).click();
    await expect(page).toHaveURL(place.url);
    await expect(pane).toBeVisible();
    if (place.heading) {
      await expect(pane.getByRole("heading", { name: place.heading, exact: true })).toBeVisible();
    }
    await expect(nav.getByTestId(`sidebar-${place.id}`)).toHaveAttribute("aria-current", "page");
    await expectSidebarIntact(page);
    await captureScreenshot(page, testInfo, place.shot);
  }

  const more: Array<{ name: string; url: RegExp; heading: string; shot: string }> = [
    { name: "Workflows", url: /\/app\/workflows$/, heading: "Workflows", shot: "nav-workflows" },
    { name: "Usage", url: /\/app\/usage$/, heading: "Usage", shot: "nav-usage" },
    { name: "Artifacts", url: /\/app\/artifacts$/, heading: "Artifacts", shot: "nav-artifacts" },
    { name: "Wiki", url: /\/app\/wiki$/, heading: "Wiki", shot: "nav-wiki" },
  ];
  for (const place of more) {
    await nav.getByTestId("sidebar-more").click();
    await page.getByRole("button", { name: place.name, exact: true }).click();
    await expect(page).toHaveURL(place.url);
    await expect(pane.getByRole("heading", { name: place.heading, exact: true })).toBeVisible();
    await expect(nav.getByTestId("sidebar-more")).toHaveAttribute("aria-current", "page");
    await expectSidebarIntact(page);
    await captureScreenshot(page, testInfo, place.shot);
  }

  // Home goes back to the Chief's chat.
  await nav.getByTestId("sidebar-home").click();
  await expect(page).toHaveURL(new RegExp(`/app/${chiefId}$`));
  await expect(page.getByTestId("transcript")).toBeVisible();
});

test("the agent header is a solid row above the messages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signup(page, `agent-header-${Date.now()}@corvo.test`, "password12", "Agent Header");
  await completeOnboarding(page);
  const trigger = page.getByTestId("bot-settings-trigger");
  await expect(trigger).toContainText("Chief");
  await expect(page.getByRole("button", { name: "Agent computer" })).toBeVisible();
  const header = await trigger.evaluate((node) => {
    const row = node.parentElement as HTMLElement;
    const box = row.getBoundingClientRect();
    return { bottom: box.bottom, position: getComputedStyle(row).position };
  });
  expect(header.position).not.toBe("absolute");
  const transcript = await page.getByTestId("transcript").boundingBox();
  expect(transcript?.y).toBeGreaterThanOrEqual(header.bottom - 1);
  await captureScreenshot(page, testInfo, "agent-header-solid");
});
