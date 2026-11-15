import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 760, height: 560 } });

for (const theme of ["light", "dark"]) {
  test(`the sidebar counts unread messages, shows who is here, and the inbox lists what needs you (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/inbox-unread.html?theme=${theme}`);
    const rows = page.getByTestId("channel-row");
    await expect(rows.nth(0).locator("[data-roster-unread-count]")).toHaveText("4 (unread)");
    // A mention is the strong badge, and a count past 99 is capped.
    await expect(rows.nth(1).locator("[data-roster-unread-count]")).toHaveAttribute(
      "data-mention",
      "true",
    );
    await expect(rows.nth(2).locator("[data-roster-unread-count]")).toContainText("99+");
    await expect(rows.nth(3).locator("[data-roster-unread-dot]")).toBeVisible();
    await expect(
      rows.nth(4).locator("[data-roster-unread-count], [data-roster-unread-dot]"),
    ).toHaveCount(0);

    const people = page.getByTestId("people-list");
    await expect(people.locator('[data-presence="online"]')).toHaveCount(1);
    await expect(people.locator('[data-presence="away"]')).toHaveCount(1);
    await expect(people.locator("[data-presence]")).toHaveCount(2);

    const items = page.getByTestId("inbox").locator("[data-inbox-item]");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toHaveAttribute("data-inbox-item", "unread");
    await expect(items.nth(2)).toContainText("Monthly limit reached at 90%");
    await expect(items.nth(3)).toHaveAttribute("data-inbox-item", "read");
    await captureScreenshot(page, testInfo, `inbox-unread-${theme}`);
  });
}
