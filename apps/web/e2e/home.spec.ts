import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, rpc, signup } from "./helpers";

test.use({ locale: "pt-BR" });

type BootBot = { id: string; name: string; color: string };

/** Pins the live lists to fixtures: two agents working, one waiting, routines today and tomorrow. */
async function fixtureTeam(page: Page) {
  const { bots } = await rpc<{ bots: BootBot[] }>(page, "bootstrap", {});
  const chief = bots[0] as BootBot;
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const run = (id: string, snippet: string, startedMs: number) => ({
    runId: id,
    botId: chief.id,
    botName: chief.name,
    groupId: null,
    groupName: null,
    threadId: `thread-${id}`,
    status: "running",
    trigger: "user_message",
    notificationsEnabled: true,
    promptSnippet: snippet,
    agentMessage: null,
    updatedAt: iso(0),
    startedAt: iso(-startedMs),
  });
  const json = (body: unknown) => ({
    contentType: "application/json",
    body: JSON.stringify({ json: body }),
  });
  await page.route("**/rpc/runs/list", (route) =>
    route.fulfill(
      json({
        runs: [
          run("run-1", "Reading the sales sheet and drafting the weekly summary", 134_000),
          run("run-2", "Checking tomorrow's calendar for conflicts", 47_000),
        ],
      }),
    ),
  );
  await page.route("**/rpc/approvals/list", (route) =>
    route.fulfill(
      json([
        {
          runId: "run-3",
          messageId: "msg-1",
          botId: chief.id,
          botName: chief.name,
          botColor: chief.color,
          block: { kind: "ask", text: "Send the weekly report to the whole team?" },
          createdAt: iso(-60_000),
        },
      ]),
    ),
  );
  await page.route("**/rpc/routines/calendar", (route) =>
    route.fulfill(
      json({
        truncated: false,
        occurrences: [
          {
            routineId: "r-1",
            name: "Monitor alerts from the support inbox and summarise anything urgent",
            botId: chief.id,
            botName: chief.name,
            at: iso(14 * 60_000),
            state: "upcoming",
            runId: null,
          },
          {
            routineId: "r-2",
            name: "Weekly planning digest",
            botId: chief.id,
            botName: chief.name,
            at: iso(26 * 3_600_000),
            state: "upcoming",
            runId: null,
          },
        ],
      }),
    ),
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`Home greets, shows live work and what is next (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signup(page, `home-${theme}-${Date.now()}@corvo.test`, "password12", "Ana Souza");
    await fixtureTeam(page);
    await page.goto("/app/home");

    await expect(
      page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite), Ana$/ }),
    ).toBeVisible();
    const checklist = page.getByTestId("home-checklist");
    await expect(checklist).toContainText(/Continue de onde parou · \d de 4/);
    await checklist.getByRole("button").click();
    await expect(checklist.getByRole("link", { name: "Criar uma rotina" })).toBeVisible();
    await expect(page.getByTestId("home-status")).toContainText("2 agentes trabalhando");
    await expect(page.getByTestId("home-waiting")).toContainText("Esperando você");
    await expect(page.getByTestId("home-waiting")).toContainText(
      "Send the weekly report to the whole team?",
    );
    await expect(page.getByTestId("home-working-row")).toHaveCount(2);
    await expect(page.getByTestId("home-routines")).toContainText(
      "Monitor alerts from the support inbox and summarise anything urgent",
    );
    await captureScreenshot(page, testInfo, `home-live-${theme}`);
  });

  test(`Home rests when nothing is running (${theme})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signup(page, `home-idle-${theme}-${Date.now()}@corvo.test`, "password12", "Ana Souza");
    await page.goto("/app/home");

    await expect(page.getByTestId("home-idle")).toContainText("Nada em andamento agora.");
    await expect(page.getByTestId("home-waiting")).toContainText("Nada esperando você agora.");
    await expect(page.getByTestId("home-routines")).toContainText("Próximas rotinas");
    await captureScreenshot(page, testInfo, `home-idle-${theme}`);
  });
}

test("Home lets a person hide a card and brings it back", async ({ page }) => {
  await signup(page, `home-organize-${Date.now()}@corvo.test`, "password12", "Org");
  await page.goto("/app/home");
  await page.getByTestId("home-organize").click();
  await page.getByTestId("home-waiting").getByRole("button", { name: "Ocultar" }).click();
  await expect(page.getByTestId("home-waiting")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("home-waiting")).toHaveCount(0);
  await page.getByRole("button", { name: "Adicionar widget" }).click();
  await page.getByRole("menuitem", { name: "Esperando você" }).click();
  await expect(page.getByTestId("home-waiting")).toBeVisible();
});

test("asking from Home starts the chat with the Rook", async ({ page }) => {
  await signup(page, `home-ask-${Date.now()}@corvo.test`, "password12", "Ask");
  await page.goto("/app/home");
  const composer = page.getByTestId("home-composer").getByRole("textbox");
  await composer.fill("Faça um resumo do dia");
  await composer.press("Enter");
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page).not.toHaveURL(/\/app\/home$/);
  await expect(page.getByTestId("transcript").getByText("Faça um resumo do dia")).toBeVisible();
});

test("the app opens on Home from the root address", async ({ page }) => {
  await signup(page, `home-root-${Date.now()}@corvo.test`, "password12", "Root");
  await page.goto("/");
  await page.waitForURL(/\/app\/home$/);
});
