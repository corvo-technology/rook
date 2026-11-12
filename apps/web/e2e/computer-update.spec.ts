import type { ComputerUpdate } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, signup } from "./helpers";

test("computer maintenance shows durable background progress and failure recovery", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("corvo.uiAppearance", "dark"));
  await signup(page, `computer-update-${Date.now()}@corvo.test`, "password12", "Computer Update");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  let updates: ComputerUpdate[] = [];
  const updating: ComputerUpdate = {
    id: "update-example",
    botId,
    name: "Chief",
    mode: "team",
    action: "update",
    status: "running",
    stage: "restoring",
  };
  await page.route("**/rpc/computer/updates", (route) =>
    route.fulfill({ json: { json: updates } }),
  );
  await page.route("**/rpc/computer/update", (route) => {
    updates = [updating];
    return route.fulfill({ json: { json: updating } });
  });
  let finishRecovery: (() => void) | undefined;
  let holdRecovery = false;
  await page.route("**/rpc/computer/recover", async (route) => {
    if (holdRecovery) {
      await new Promise<void>((resolve) => {
        finishRecovery = resolve;
      });
    }
    updates = [{ ...updating, id: "recovery-example", action: "recover", stage: "preparing" }];
    return route.fulfill({ json: { json: updates[0] } });
  });
  await page.getByRole("button", { name: "Agent computer", exact: true }).click();
  await expect(page.getByTestId("computer-preview")).toBeVisible();
  await page.getByTestId("computer-preview").hover();
  await page.getByTestId("computer-preview-open").click();
  await page.getByTestId("computer-more-button").click();
  await expect(page.getByText("Recreate a computer that is not working.")).toBeVisible();
  await expect(page.getByText("Restore the last saved workspace.", { exact: true })).toBeVisible();
  await expect(page.getByText("Save the workspace and install current software.")).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-maintenance-menu");
  await page.getByRole("menuitem", { name: "Recover computer", exact: true }).click();
  // The first click arms the item in place; a second click runs it.
  await expect(page.getByRole("menuitem", { name: "Confirm recover?" })).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-maintenance-recover-confirmation");
  await page.keyboard.press("Escape");
  await page.getByTestId("computer-more-button").click();
  await page.getByRole("menuitem", { name: "Reset computer", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Confirm reset?" })).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-maintenance-reset-confirmation");
  await page.keyboard.press("Escape");
  await page.getByTestId("computer-more-button").click();
  await page.getByRole("menuitem", { name: "Recover computer", exact: true }).click();
  holdRecovery = true;
  await page.getByRole("menuitem", { name: "Confirm recover?" }).click();
  await expect.poll(() => finishRecovery).toBeDefined();
  finishRecovery!();
  holdRecovery = false;
  const recoveryProgress = page.getByTestId("computer-update-details");
  await expect(recoveryProgress).toBeVisible();
  await page.getByRole("button", { name: /Recovering Team Computer/ }).click();
  updates = [];
  await expect(page.getByRole("button", { name: /Recovering Team Computer/ })).toHaveCount(0);
  await page.getByTestId("computer-more-button").click();
  await page.getByRole("menuitem", { name: "Update computer", exact: true }).click();
  const dialog = page.getByTestId("computer-update-details");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: /Updating Team Computer/ })).toBeVisible();
  await expect(dialog.locator('[aria-current="step"]')).toHaveText("Restoring your workspace");
  await captureScreenshot(page, testInfo, "computer-update-progress");
  await page.getByRole("button", { name: /Updating Team Computer/ }).click();
  await expect(dialog).not.toBeVisible();
  await captureScreenshot(page, testInfo, "computer-update-background");
  await page.reload();
  await page.getByRole("button", { name: /Updating Team Computer/ }).click();
  await expect(dialog).toBeVisible();
  updates = [{ ...updating, status: "interrupted" }];
  await expect(
    dialog.getByText("Recovery is unavailable until the previous operation has stopped."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Recover computer" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "computer-update-interrupted");
  // Older wire flags cannot expose a server lock-release control in the app.
  updates = [{ ...updating, status: "interrupted", canReleaseReservation: true }];
  await expect(dialog.getByRole("button", { name: "Release computer", exact: true })).toBeHidden();
  updates = [{ ...updating, status: "failed" }];
  await expect(dialog.getByRole("button", { name: "Recover computer", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Update failed/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-update-failed");
  await dialog.getByRole("button", { name: "Recover computer" }).click();
  await expect(page.getByRole("button", { name: /Recovering Team Computer/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "computer-recovery-progress");
  updates = [];
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Recovering Team Computer/ })).toHaveCount(0);
});
