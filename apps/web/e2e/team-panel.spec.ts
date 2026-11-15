import { expect, test } from "@playwright/test";
import { captureScreenshot, holdToApprove } from "./helpers";

test.use({ viewport: { width: 1100, height: 760 } });

for (const theme of ["light", "dark"]) {
  test(`a channel lists who sees it, by role, with its agents (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/team-panel.html?view=panel&theme=${theme}`);
    const panel = page.getByTestId("channel-members");
    await expect(panel.getByText("Who sees this channel")).toBeVisible();
    await expect(panel.getByRole("heading")).toHaveText(["Owner", "Finance", "Everyone", "Agents"]);
    await expect(panel.getByText("Reports")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Add people or agents" })).toBeVisible();
    await captureScreenshot(page, testInfo, `channel-members-${theme}`);
  });
}

test("a private channel lists only the people added to it", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/team-panel.html?view=panel&private=1");
  const panel = page.getByTestId("channel-members");
  await expect(panel.getByRole("heading")).toHaveText(["Owner", "Finance", "Agents"]);
  await expect(panel.getByText("Marta")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Remove Joao" })).toBeAttached();
  await captureScreenshot(page, testInfo, "channel-members-private");
});

for (const theme of ["light", "dark"]) {
  test(`the approvals inbox counts what waits and falls as each is decided (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/team-panel.html?view=approvals&theme=${theme}`);
    const count = page.getByTestId("sidebar-approvals-count");
    await expect(count).toHaveText("2");
    const items = page.getByTestId("approval-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Cora");
    await expect(items.first()).toContainText("#finance");
    await expect(items.first()).toContainText("accountant@firm.example");
    await captureScreenshot(page, testInfo, `approvals-inbox-${theme}`);

    // A tap approves nothing; holding does, and the count follows.
    const approve = items.first().getByRole("button", { name: "Hold to approve" });
    await approve.click();
    await expect(items).toHaveCount(2);
    await holdToApprove(approve);
    await expect(items).toHaveCount(1);
    await expect(count).toHaveText("1");
    await items.first().getByRole("button", { name: "Not now" }).click();
    await expect(page.getByTestId("approvals-empty")).toBeVisible();
    await expect(page.getByTestId("sidebar-approvals")).toHaveCount(0);
  });
}
