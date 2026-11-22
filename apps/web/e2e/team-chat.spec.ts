import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, holdToApprove } from "./helpers";

test.use({ viewport: { width: 1100, height: 820 } });

const pinned = {
  id: "m3",
  threadId: "thread-1",
  seq: 3,
  role: "bot",
  botId: "bento",
  blocks: [{ kind: "text", text: "It was: the 12.90 fee went into the ERP twice." }],
  pinnedAt: "2026-11-10T09:30:00.000Z",
  createdAt: "2026-11-10T08:09:00.000Z",
};

async function openChannel(page: Page, theme: string) {
  // Only the pin list and the channel search reach the API from this fixture.
  await page.route("**/rpc/threads/pinned", (route) =>
    route.fulfill({ json: { json: { messages: [pinned] } } }),
  );
  await page.route("**/rpc/search/query", (route) =>
    route.fulfill({
      json: {
        json: {
          hits: [
            {
              kind: "message",
              groupId: "group-1",
              title: "finance",
              snippet: "the 12.90 fee went into the ERP twice",
              messageId: "m3",
              seq: 3,
            },
          ],
        },
      },
    }),
  );
  await page.goto(`/e2e/fixtures/team-chat.html?theme=${theme}`);
}

for (const theme of ["light", "dark"]) {
  test(`a team channel shows routines, tools, a pin and an approval held to approve (${theme})`, async ({
    page,
  }, testInfo) => {
    await openChannel(page, theme);
    const main = page.locator("main").getByTestId("transcript");

    // A routine's message names the routine beside its author.
    await expect(main.getByTestId("routine-badge")).toHaveText("Routine “Daily reconciliation”");
    // The tools of a run fold into one line.
    const tools = main.getByTestId("tool-activity");
    await expect(tools).toContainText("Used 3 tools");
    await expect(tools).toContainText("40s");
    // The pinned message is marked, and the header lists it.
    await expect(main.getByTestId("pinned-mark")).toHaveCount(1);
    await expect(main.getByTestId("message-reactions")).toContainText("👍");

    // The approval shows exactly what will run, and a tap approves nothing.
    await expect(main.getByText("attachment: income-statement-october.xlsx")).toBeVisible();
    const approve = main.getByRole("button", { name: "Hold to approve" });
    await approve.click();
    await expect(approve).toBeVisible();
    await captureScreenshot(page, testInfo, `team-chat-${theme}`);

    await holdToApprove(approve);
    await expect(main.getByTestId("ask-decided")).toContainText("Allowed once");
  });
}

test("Not now answers an approval at a tap", async ({ page }) => {
  await openChannel(page, "light");
  const main = page.locator("main").getByTestId("transcript");
  await main.getByRole("button", { name: "Not now" }).click();
  await expect(main.getByTestId("ask-decided")).toContainText("Not now");
});

test("an approval is approved by holding Enter", async ({ page }) => {
  await openChannel(page, "light");
  const main = page.locator("main").getByTestId("transcript");
  const approve = main.getByRole("button", { name: "Hold to approve" });
  await approve.focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(1_000);
  await page.keyboard.up("Enter");
  await expect(main.getByTestId("ask-decided")).toContainText("Allowed once");
});

test("with reduced motion the approval is a plain button", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openChannel(page, "light");
  const main = page.locator("main").getByTestId("transcript");
  await main.getByRole("button", { name: "Allow once" }).click();
  await expect(main.getByTestId("ask-decided")).toContainText("Allowed once");
});

test("the header lists the pinned messages and jumps to one", async ({ page }, testInfo) => {
  await openChannel(page, "light");
  await page.getByRole("button", { name: "Pinned messages" }).click();
  const list = page.getByTestId("channel-pins");
  await expect(list).toContainText("Bento");
  await expect(list).toContainText("the 12.90 fee went into the ERP twice");
  await captureScreenshot(page, testInfo, "team-chat-pins");
  await list.getByRole("button").first().click();
  await expect(page.locator("body")).toHaveAttribute("data-jumped", "m3");
});

test("a message is pinned and unpinned from its menu", async ({ page }) => {
  await openChannel(page, "light");
  const main = page.locator("main").getByTestId("transcript");
  const row = main.locator("[data-message-id]").filter({ hasText: "Good morning" });
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect(main.getByTestId("pinned-mark")).toHaveCount(2);
  await row.hover();
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(main.getByTestId("pinned-mark")).toHaveCount(1);
});

test("the channel search finds a message and jumps to it", async ({ page }, testInfo) => {
  await openChannel(page, "light");
  await page.getByRole("searchbox", { name: "Search" }).fill("fee");
  const results = page.getByTestId("channel-search-results");
  await expect(results).toContainText("the 12.90 fee went into the ERP twice");
  await captureScreenshot(page, testInfo, "team-chat-search");
  await results.getByRole("button").click();
  await expect(page.locator("body")).toHaveAttribute("data-jumped", "m3");
});

test.describe("the channel as the approved canvas draws it", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"]) {
    test(`sidebar, header, people and agents, cards and the members panel (${theme})`, async ({
      page,
    }, testInfo) => {
      await page.route("**/rpc/threads/pinned", (route) =>
        route.fulfill({ json: { json: { messages: [] } } }),
      );
      await page.goto(`/e2e/fixtures/team-canvas.html?theme=${theme}`);
      const sidebar = page.getByTestId("canvas-sidebar");
      // The space, its places, then channels, agents and people.
      await expect(sidebar.getByText("2 people · 4 agents")).toBeVisible();
      await expect(sidebar.getByTestId("sidebar-nav").getByRole("button")).toHaveText([
        "Home",
        "Approvals1",
        "Tasks",
        "Routines",
        "Activity",
        "More",
      ]);
      await expect(sidebar.getByText("Channels")).toBeVisible();
      await expect(sidebar.getByText("Agents", { exact: true })).toBeVisible();
      await expect(sidebar.getByText("Reports")).toBeVisible();
      await expect(sidebar.getByText("People", { exact: true })).toBeVisible();
      // The header: the channel, its search, its pins, who is in it.
      await expect(page.getByRole("searchbox", { name: "Search" })).toHaveAttribute(
        "placeholder",
        "Search in #finance",
      );
      await expect(page.getByRole("button", { name: "Pinned messages" })).toBeVisible();
      await expect(page.getByTestId("channel-members-toggle")).toHaveText("5 members");
      // Every message names its author, with a role: people and agents alike.
      const main = page.locator("main").getByTestId("transcript");
      await expect(main.getByText("Pedro Henrique", { exact: true })).toBeVisible();
      await expect(main.getByText("Owner", { exact: true })).toBeVisible();
      await expect(main.getByText("João Victor").first()).toBeVisible();
      await expect(main.getByTestId("routine-badge")).toBeVisible();
      await expect(main.getByTestId("tool-activity")).toContainText("Used 3 tools");
      await expect(main.getByTestId("task-card")).toContainText("Created task FIN-42");
      // The approval: who it is asked of, the line it runs, and the hold.
      const card = main.getByTestId("approval-card");
      await expect(card).toContainText("Needs your approval · you own Cora");
      await expect(card).toContainText("Gmail · send_email · to: accountant@office.example");
      await expect(card.getByRole("button", { name: "Hold to approve" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Not now" })).toBeVisible();
      // The panel of who sees the channel.
      const panel = page.getByTestId("channel-members");
      await expect(panel.getByRole("heading")).toHaveText([
        "Owner — 1",
        "Finance — 1",
        "Agents — 3",
      ]);
      await expect(panel.getByRole("button", { name: "Add people or agents" })).toBeVisible();
      await captureScreenshot(page, testInfo, `team-canvas-${theme}`);
    });
  }
});

test.describe("a chat with one agent uses the channel's rows", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"]) {
    test(`rows, relayed message, unread and footer (${theme})`, async ({ page }, testInfo) => {
      await page.goto(`/e2e/fixtures/team-canvas.html?theme=${theme}&view=agent`);
      const sidebar = page.getByTestId("canvas-sidebar");
      const main = page.locator("main").getByTestId("transcript");
      // Nobody gets a bubble: the person and the agent both sit in rows under their names.
      await expect(main.getByText("Pedro Henrique", { exact: true })).toBeVisible();
      await expect(main.getByTestId("message-user-bubble").first()).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await expect(main.getByTestId("message-bot-bubble").first()).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      // A message another agent sent shows that agent, its role, and who it came through.
      const relayed = main.locator("[data-message-id]").filter({ hasText: "via Rook" });
      await expect(relayed).toContainText("CTO");
      await expect(relayed).toContainText("Engineering");
      // Unread channels are bold; read ones are not.
      await expect(sidebar.getByText("sales", { exact: true })).toHaveCSS("font-weight", "600");
      await expect(sidebar.getByText("finance", { exact: true })).not.toHaveCSS(
        "font-weight",
        "600",
      );
      // The signed-in person and the bell sit in the footer.
      const footer = sidebar.getByTestId("sidebar-footer");
      await expect(footer).toContainText("Pedro Henrique");
      await expect(footer.getByRole("button", { name: "Notifications" })).toBeVisible();
      // The sidebar is its own surface, separated from the page by a hairline.
      const surfaces = await page.evaluate(() => {
        const pick = (selector: string) =>
          getComputedStyle(document.querySelector(selector) as Element).backgroundColor;
        return { sidebar: pick('[data-testid="canvas-sidebar"]'), page: pick("body") };
      });
      expect(surfaces.sidebar).not.toBe(surfaces.page);
      await captureScreenshot(page, testInfo, `agent-chat-${theme}`);
    });
  }

  test("the message actions are reached with the keyboard", async ({ page }) => {
    await page.goto("/e2e/fixtures/team-canvas.html?theme=light&view=agent");
    const row = page.locator("main").locator("[data-message-id]").nth(1);
    const rail = row.getByTestId("message-hover-rail");
    // At rest the actions are hidden from view but not from the keyboard.
    await expect(rail).toHaveCSS("opacity", "0");
    await row.getByRole("button", { name: "Speak this reply" }).focus();
    await expect(rail).toHaveCSS("opacity", "1");
    for (const name of ["React", "Reply", "More"]) {
      await page.keyboard.press("Tab");
      await expect(row.getByRole("button", { name, exact: true })).toBeFocused();
    }
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
  });
});
