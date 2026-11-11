import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("opens Artifacts from the navigation list and lists created files", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `artifacts-tab-${stamp}@corvo.test`, "password12", "Artifacts Tab");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  const chiefId = activeBotId(page);

  // Navigation sits at the top of the one sidebar, with the account at its bottom.
  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar).toBeVisible();
  const nav = sidebar.getByTestId("sidebar-nav");
  await expect(nav.getByRole("button", { name: "Agents" })).toBeInViewport();
  await expect(nav.getByRole("button", { name: "Store" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-current", "page");
  await page.getByTestId("user-menu-trigger").click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "account-menu-artifacts");
  await page.keyboard.press("Escape");

  await nav.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/artifacts$/);
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
  await expect(page.getByText("No artifacts found.")).toBeVisible();
  await captureScreenshot(page, testInfo, "artifacts-empty");

  await page.setViewportSize({ width: 360, height: 700 });
  const narrowHeading = page.getByRole("heading", { name: "Artifacts", exact: true });
  const narrowCardView = page.getByRole("button", { name: "Card view" });
  await expect(narrowHeading).toBeVisible();
  await expect(narrowCardView).toBeVisible();
  const headingBox = await narrowHeading.boundingBox();
  const cardViewBox = await narrowCardView.boundingBox();
  expect(headingBox?.width).toBeGreaterThan(40);
  expect(headingBox?.x).toBeGreaterThanOrEqual(0);
  expect((headingBox?.x ?? 0) + (headingBox?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(cardViewBox?.x).toBeGreaterThanOrEqual(0);
  expect((cardViewBox?.x ?? 0) + (cardViewBox?.width ?? 0)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 720 });

  await rpc(page, "artifacts/create", {
    botId: chiefId,
    name: "notes/artifacts-tab.md",
    mimeType: "text/markdown",
    contentBase64: Buffer.from("# Artifacts tab").toString("base64"),
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Artifacts", exact: true })).toBeVisible();
  await expect(page.getByText("notes/artifacts-tab.md")).toBeVisible();
  await captureScreenshot(page, testInfo, "artifacts-list");

  await page.getByRole("link", { name: /notes\/artifacts-tab\.md/ }).click();
  await expect(page).toHaveURL(/\/app\/artifacts\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "notes/artifacts-tab.md" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifacts tab" })).toBeVisible();
  await captureScreenshot(page, testInfo, "artifacts-preview");

  await page.getByRole("link", { name: "Bots" }).click();
  await expect(page).toHaveURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  await expect(page.getByTestId("transcript")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileSidebar = page.getByTestId("bots-sidebar");
  await mobileSidebar.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("button", { name: "Artifacts", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await mobileSidebar.getByTestId("user-menu-trigger").click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "account-menu-artifacts-mobile");
});
