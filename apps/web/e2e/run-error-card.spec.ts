import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test.use({ locale: "pt-BR" });

type ThreadCarrier = {
  threadId?: string;
  run?: unknown;
  activeRuns?: unknown[];
  thread?: ThreadCarrier;
};

/** Render fixture only: a run that failed because the agent's computer is out of space. */
function injectFailedRun(body: { json?: ThreadCarrier }) {
  const targets = [body.json, body.json?.thread].filter((target): target is ThreadCarrier =>
    Boolean(target?.threadId),
  );
  const now = new Date().toISOString();
  for (const target of targets) {
    target.run = {
      id: "run-storage-full",
      botId: "bot-qa",
      threadId: target.threadId,
      taskId: "task-storage-full",
      status: "failed",
      trigger: "user",
      routineId: null,
      modelProvider: null,
      modelId: null,
      error: "Couldn't start the agent's computer.\nThe computer's storage is full.",
      errorInfo: {
        code: "computer_storage_full",
        params: {
          agent: "QA",
          usedMb: "10035",
          totalMb: "10240",
          top: ".codex 475 MB, .browser-profiles 340 MB",
        },
      },
      startedAt: now,
      completedAt: now,
      createdAt: now,
    };
    target.activeRuns = [];
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`a full computer says so in Portuguese with the actions that fix it (${theme})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await signup(page, `run-error-${theme}-${Date.now()}@corvo.test`, "password12", "Ana Souza");
    await completeOnboarding(page);

    const fulfillFailedRun = async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
      const response = await route.fetch();
      const body = (await response.json()) as { json?: ThreadCarrier };
      injectFailedRun(body);
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: JSON.stringify(body),
      });
    };
    await page.route("**/rpc/bootstrap", fulfillFailedRun);
    await page.route("**/rpc/threads/get", fulfillFailedRun);
    await page.reload({ waitUntil: "domcontentloaded" });

    const card = page.getByTestId("run-error-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("O computador do QA está sem espaço");
    await expect(card).toContainText("Os maiores: .codex 475 MB, perfis do navegador 340 MB.");
    await expect(card.getByRole("button", { name: "Liberar espaço" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Recuperar computador" })).toBeVisible();
    await expect(card).not.toContainText("Couldn't start");
    await expect(card.locator("details")).not.toHaveAttribute("open", "");
    await captureScreenshot(page, testInfo, `run-error-storage-full-${theme}`);
  });
}
