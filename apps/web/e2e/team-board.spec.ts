import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1500, height: 900 } });

for (const theme of ["light", "dark"]) {
  test(`the Team screen shows each team with what it is for and what each agent is doing (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/e2e/fixtures/team-board.html?theme=${theme}&locale=en`);

    // The Rook leads, and is not listed again among those with no team.
    await expect(page.getByTestId("team-chief")).toContainText("Rook");
    await expect(page.getByTestId("team-unassigned")).not.toContainText("Rook");
    await expect(page.getByTestId("team-unassigned")).toContainText("Not in a team");

    // A team says what it is for, how many are in it and how many are working.
    const product = page.getByTestId("team-produto-ops");
    await expect(product).toContainText("Analisa produto e rotinas e vigia a operação");
    await expect(product).toContainText("3 agents");
    await expect(product).toContainText("1 working");

    // What each agent is doing, not what it last wrote, with what needs you first.
    await expect(page.getByTestId("member-produto")).toContainText("Error");
    await expect(page.getByTestId("member-redacao")).toContainText("Needs an answer");
    await expect(page.getByTestId("member-ops")).toContainText("Working…");
    await expect(page.getByTestId("member-pautas")).toContainText("5h ago");
    await expect(page.getByText("Stopped. This was still waiting for")).toHaveCount(0);
    const order = await product
      .locator('[data-testid^="member-"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
    expect(order).toEqual(["member-produto", "member-ops", "member-pautas"]);

    // Every team is shown, however many agents it has, and none is left empty.
    await expect(
      page.locator('[data-testid^="team-"]:not([data-testid="team-chief"])'),
    ).toHaveCount(7);
    await captureScreenshot(page, testInfo, `team-board-${theme}`);
  });
}

test("on a phone the teams stack in one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/e2e/fixtures/team-board.html?theme=dark&locale=en");
  const [first, second] = await Promise.all([
    page.getByTestId("team-produto-ops").boundingBox(),
    page.getByTestId("team-marketing").boundingBox(),
  ]);
  expect(first && second && second.y > first.y + first.height - 1).toBe(true);
  expect(first && first.width > 300).toBe(true);
});
