import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  chooseOption,
  completeOnboarding,
  connectionRow,
  createNamedBot,
  expandAdvancedSection,
  openUserSettings,
  rpc,
  signup,
} from "./helpers";

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await captureScreenshot(page, testInfo, `${name}-${theme}`);
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
}

test("one Connections page lists what exists, who uses it and how far", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signup(page, `connections-${Date.now()}@corvo.test`, "password12", "Connections");
  await completeOnboarding(page);
  const engineer = await createNamedBot(page, "Engineer");
  const qa = await createNamedBot(page, "QA");
  const github = await rpc<{ id: string }>(page, "mcp/servers/create", {
    slug: "github",
    name: "GitHub",
    transport: "streamable_http",
    endpoint: "https://github.example.test/mcp",
    secret: "fake-mcp-credential",
  });
  // A new connection is lent to no one until someone says so.
  expect(await rpc<unknown[]>(page, "access/list", undefined)).toEqual([]);
  await rpc(page, "access/set", {
    kind: "mcp",
    connectionId: github.id,
    botIds: [engineer, qa],
    level: "read",
  });
  await rpc(page, "access/set", {
    kind: "mcp",
    connectionId: github.id,
    botIds: [engineer],
    level: "write",
  });

  await openUserSettings(page, "connections");
  const row = connectionRow(page, "GitHub");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Used by");
  await expect(row).toContainText("Engineer");
  await expect(row).toContainText("QA");
  await shoot(page, testInfo, "connections-list");

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const connect = page.getByTestId("connect-sheet");
  await expect(connect.getByRole("button", { name: "MCP server by URL" })).toBeVisible();
  await expect(connect.getByRole("button", { name: "Mailbox" })).toBeVisible();
  await shoot(page, testInfo, "connect-sheet");
  await page.keyboard.press("Escape");
  await expect(connect).toBeHidden();

  await row.getByRole("button", { name: "Access", exact: true }).click();
  const access = page.getByTestId("access-sheet");
  await expect(access.getByText("Who can use GitHub")).toBeVisible();
  await expect(access.getByRole("combobox", { name: "Access for Engineer" })).toContainText(
    "Read and write",
  );
  await expect(access.getByRole("combobox", { name: "Access for QA" })).toContainText("Read");
  await shoot(page, testInfo, "access-sheet");

  await chooseOption(access.getByRole("combobox", { name: "Access for QA" }), "No access");
  await expect(access.getByRole("combobox", { name: "Access for QA" })).toContainText("No access");
  const levels = await rpc<Array<{ botId: string; level: string }>>(page, "access/list", undefined);
  expect(levels).toEqual([expect.objectContaining({ botId: engineer, level: "write" })]);
  await page.keyboard.press("Escape");
  await expect(row).not.toContainText("QA");

  await page.goto(`/app/${engineer}`);
  await page.getByTestId("bot-settings-trigger").click();
  await expandAdvancedSection(page.getByTestId("bot-settings-advanced"));
  const section = page.getByTestId("agent-access");
  await expect(section.getByRole("combobox", { name: "GitHub" })).toContainText("Read and write");
  await chooseOption(section.getByRole("combobox", { name: "GitHub" }), "Read");
  await expect
    .poll(async () =>
      (await rpc<Array<{ level: string }>>(page, "access/list", undefined)).map((e) => e.level),
    )
    .toEqual(["read"]);
  await shoot(page, testInfo, "agent-access");
});
