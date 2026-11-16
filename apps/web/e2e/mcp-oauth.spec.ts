import type { McpServer } from "@corvo/contracts";
import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { MCP_OAUTH_CHANNEL } from "../src/lib/mcp-oauth-channel";
import {
  captureScreenshot,
  chooseConnectionAction,
  completeOnboarding,
  connectionRow,
  expandAdvancedSection,
  signup,
} from "./helpers";

test("connects an MCP server through the OAuth popup callback", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-oauth-${stamp}@corvo.test`, "password12", "MCP OAuth");
  await completeOnboarding(page);

  let oauthStatus: McpServer["oauthStatus"] = "none";
  let hasSecret = false;
  const server: McpServer = {
    id: "mcp-oauth-server",
    spaceId: "mcp-oauth-workspace",
    slug: "linear",
    name: "Linear MCP",
    description: "",
    transport: "streamable_http",
    endpoint: "https://mcp.linear.test/mcp",
    command: null,
    args: [],
    envKeys: [],
    fileKeys: [],
    headerKeys: [],
    hasSecret,
    oauthStatus,
    oauthClientId: null,
    enabled: true,
    revision: 1,
    health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
  const browserOrigin = new URL(page.url()).origin;
  let releaseCompletion = () => {};
  let markCompletionStarted = () => {};
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  const completionStarted = new Promise<void>((resolve) => {
    markCompletionStarted = resolve;
  });

  await page.context().route("**/rpc/mcp/servers/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: [{ ...server, hasSecret, oauthStatus }] }),
    });
  });
  await page.context().route("**/rpc/mcp/assignments/all", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ json: [] }) });
  });
  await page.context().route("**/rpc/mcp/oauth/begin", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: {
        serverId: server.id,
        redirectUri: `${browserOrigin}/mcp/oauth/callback`,
      },
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          status: "authorization_required",
          sessionId: "mcp-oauth-session",
          authorizationUrl: `${browserOrigin}/mcp/oauth/callback?code=fake-code&state=mcp-oauth-session`,
        },
      }),
    });
  });
  await page.context().route("**/rpc/mcp/oauth/complete", async (route: Route) => {
    expect(route.request().postDataJSON()).toEqual({
      json: {
        sessionId: "mcp-oauth-session",
        code: "fake-code",
        state: "mcp-oauth-session",
      },
    });
    markCompletionStarted();
    await completionGate;
    oauthStatus = "connected";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: { ok: true } }),
    });
  });

  await page.getByRole("button", { name: "Store", exact: true }).click();
  await expandAdvancedSection(page.getByTestId("integrations-advanced"));
  await page.getByRole("button", { name: "Manage MCP servers", exact: true }).click();
  await expect(connectionRow(page, "Linear MCP")).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-oauth-ready");

  await chooseConnectionAction(page, "Linear MCP", "Edit");
  const editSheet = page.getByTestId("connect-sheet");
  await expect(editSheet.getByLabel("Access token (optional)")).toBeHidden();
  await editSheet.getByText("Advanced", { exact: true }).click();
  await expect(editSheet.getByLabel("Access token (optional)")).toBeVisible();
  await editSheet.getByRole("button", { name: "Cancel", exact: true }).click();

  const popupPromise = page.waitForEvent("popup");
  await chooseConnectionAction(page, "Linear MCP", "Connect OAuth");
  const popup = await popupPromise;
  await completionStarted;
  await expect(popup.getByText("Finishing MCP connection…", { exact: true })).toBeVisible();
  await captureScreenshot(popup, testInfo, "mcp-oauth-callback");

  releaseCompletion();
  await expect.poll(() => popup.isClosed()).toBe(true);
  const row = connectionRow(page, "Linear MCP");
  await row.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Reconnect OAuth", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Disconnect", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await captureScreenshot(page, testInfo, "mcp-oauth-connected");

  oauthStatus = "reconnect";
  hasSecret = true;
  await page.evaluate((channelName) => {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type: "mcp-oauth-complete" });
    channel.close();
  }, MCP_OAUTH_CHANNEL);
  await expect(connectionRow(page, "Linear MCP").getByText("Needs reconnecting")).toBeVisible();
  await captureScreenshot(page, testInfo, "mcp-oauth-expired");
});

test("adds an MCP server with a pre-registered OAuth client", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mcp-oauth-client-${stamp}@corvo.test`, "password12", "MCP OAuth");
  await completeOnboarding(page);

  const browserOrigin = new URL(page.url()).origin;
  const servers: McpServer[] = [];
  await page.context().route("**/rpc/mcp/servers/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: servers }),
    });
  });
  await page.context().route("**/rpc/mcp/servers/create", async (route) => {
    const { json } = route.request().postDataJSON() as { json: Record<string, unknown> };
    expect(json).toMatchObject({
      transport: "streamable_http",
      endpoint: "https://gmailmcp.example.test/mcp/v1",
      oauthClient: { clientId: "client-1.apps.example.test", clientSecret: "client-secret" },
    });
    const created: McpServer = {
      id: "mcp-oauth-client-server",
      spaceId: "mcp-oauth-workspace",
      slug: "gmail",
      name: "Gmail",
      description: "",
      transport: "streamable_http",
      endpoint: "https://gmailmcp.example.test/mcp/v1",
      command: null,
      args: [],
      envKeys: [],
      fileKeys: [],
      headerKeys: [],
      hasSecret: true,
      oauthStatus: "none",
      oauthClientId: "client-1.apps.example.test",
      enabled: true,
      revision: 1,
      health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    servers.push(created);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: created }),
    });
  });

  await page.getByRole("button", { name: "Store", exact: true }).click();
  await expandAdvancedSection(page.getByTestId("integrations-advanced"));
  await page.getByRole("button", { name: "Manage MCP servers", exact: true }).click();

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const sheet = page.getByTestId("connect-sheet");
  await sheet.getByRole("button", { name: "MCP server by URL" }).click();
  await sheet.getByLabel("Server name").fill("Gmail");
  await sheet.getByLabel("Server URL").fill("https://gmailmcp.example.test/mcp/v1");
  await sheet.getByText("Advanced", { exact: true }).click();
  await expect(sheet.getByLabel("Redirect URI")).toBeHidden();
  await sheet.getByLabel("OAuth client ID (optional)").fill("client-1.apps.example.test");
  await sheet.getByLabel("OAuth client secret (optional)").fill("client-secret");
  await expect(sheet.getByLabel("Redirect URI")).toHaveValue(`${browserOrigin}/mcp/oauth/callback`);
  await captureScreenshot(page, testInfo, "mcp-oauth-client-form");

  await sheet.getByRole("button", { name: "Add server", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(connectionRow(page, "Gmail")).toBeVisible();
});
