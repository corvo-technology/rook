import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, createNamedBot, signup } from "./helpers";

test("board creates a ticket and opens it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  const title = "Ship the board";
  const description = "Track the kanban launch.";
  await signup(page, `board-${stamp}@corvo.test`, "password12", "Board QA");
  await completeOnboarding(page);
  await createNamedBot(page, "Planner");

  await page.getByTestId("app-rail").getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/board$/);
  await expect(page.getByTestId("board-columns")).toBeVisible();
  await expect(page.getByText("No tickets yet", { exact: true })).toBeVisible();
  const board = page.getByTestId("board-columns");
  expect(await board.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: "Won't do", exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 800, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    await board.evaluate(
      (node) => node.parentElement!.scrollWidth > node.parentElement!.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await captureScreenshot(page, testInfo, "board-kanban");

  await page.getByRole("button", { name: "New ticket", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New ticket" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill(description);
  const owner = dialog.getByLabel("Owner");
  await expect(owner.locator("option", { hasText: "Planner" })).toHaveCount(1);
  await owner.selectOption({ label: "Planner" });
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  await expect(dialog).toBeHidden();
  const card = page.locator("[data-testid^='board-card-']").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Planner");
  await captureScreenshot(page, testInfo, "board-ticket-created");

  await card.click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail.getByLabel("Title")).toHaveValue(title);
  await expect(detail.getByTestId("ticket-description")).toHaveValue(description);
  await expect(detail.getByTestId("ticket-comments")).toBeVisible();
  await detail.getByRole("button", { name: "Add field", exact: true }).click();
  await detail.getByLabel("Field name").fill("Contact");
  await detail.getByLabel("Field value").fill("ana@example.com");
  await detail.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(detail).toBeHidden();
  await card.click();
  await expect(page.getByRole("dialog", { name: title }).getByLabel("Field value")).toHaveValue(
    "ana@example.com",
  );
  await captureScreenshot(page, testInfo, "board-ticket-detail");

  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await page.getByRole("button", { name: "Task settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Task settings" });
  await settings.getByLabel("In progress", { exact: true }).fill("In contact");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toBeHidden();
  await expect(page.getByRole("heading", { name: "In contact", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "board-renamed-column");

  // A ticket in progress shows under its owner on the Team screen, and opens on the board.
  await page
    .getByTestId(/board-card-/)
    .first()
    .click();
  await page.getByRole("dialog", { name: title }).getByLabel("Status").selectOption("doing");
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Save", exact: true })
    .first()
    .click();
  await page.goto("/app/team");
  const owned = page.locator("[data-testid^='member-tickets-']").filter({ hasText: title });
  await expect(owned).toBeVisible();
  await captureScreenshot(page, testInfo, "team-agent-tickets");
  await owned.getByRole("button").first().click();
  await expect(page).toHaveURL(/\/app\/board\?ticket=/);
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
});
