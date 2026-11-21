import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("makes an MCP key, shows it once, and revokes it", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-keys-${stamp}@corvo.test`, "password12", "MCP keys");
  await completeOnboarding(page);
  const settings = await openUserSettings(page, "mcp-access");
  const panel = settings.getByTestId("mcp-settings");

  await expect(panel.getByTestId("mcp-url")).toHaveText(/\/mcp$/);
  await expect(panel).toContainText("claude mcp add --transport http rook");
  await expect(panel.getByRole("listitem")).toHaveCount(0);

  await panel.getByRole("textbox", { name: "Name" }).fill("laptop");
  await panel.getByRole("button", { name: "Create key" }).click();

  const secret = panel.getByTestId("mcp-secret");
  await expect(secret).toHaveText(/^rk_/);
  const key = (await secret.textContent()) ?? "";
  // The command carries the key so it can be pasted as it is.
  await expect(panel).toContainText(`Bearer ${key}`);
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await expect(panel.getByRole("listitem")).toContainText("laptop");
  await expect(panel.getByRole("listitem")).toContainText("Never used");
  await captureScreenshot(page, testInfo, "mcp-settings-created");

  const listTools = (bearer: string) =>
    page.request.post("/mcp", {
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
  const listed = await listTools(key);
  expect(listed.status()).toBe(200);
  const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
  // A talk key reads and talks but does not configure.
  expect(names).toContain("send_message");
  expect(names).not.toContain("create_agent");

  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel.getByTestId("mcp-created")).toHaveCount(0);
  await page.reload();
  const reloaded = (await openUserSettings(page, "mcp-access")).getByTestId("mcp-settings");
  await expect(reloaded.getByRole("listitem")).toHaveCount(1);
  await expect(reloaded).not.toContainText(key);

  await reloaded.getByRole("button", { name: "Revoke laptop" }).click();
  await reloaded.getByRole("button", { name: "Confirm revoke?" }).click();
  await expect(reloaded.getByRole("listitem")).toHaveCount(0);
  expect((await listTools(key)).status()).toBe(401);
});
