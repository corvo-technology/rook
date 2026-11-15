import type { MailboxDto } from "@corvo/contracts";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("connects a mailbox and gives it to an agent", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mailboxes-${stamp}@corvo.test`, "password12", "Mailboxes");
  await completeOnboarding(page);

  const mailboxes: MailboxDto[] = [];
  await page.context().route("**/rpc/mailboxes/list", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: mailboxes }),
    });
  });
  await page.context().route("**/rpc/mailboxes/create", async (route) => {
    const { json } = route.request().postDataJSON() as { json: Record<string, unknown> };
    // The password goes up once, with the servers parsed from what was typed.
    expect(json).toMatchObject({
      address: "owner@example.test",
      username: "owner@example.test",
      password: "app-password",
      imap: { host: "imap.example.test", port: 993, secure: true },
      smtp: { host: "smtp.example.test", port: 587, secure: false },
    });
    const created: MailboxDto = {
      id: "mailbox-1",
      address: "owner@example.test",
      username: "owner@example.test",
      imap: { host: "imap.example.test", port: 993, secure: true },
      smtp: { host: "smtp.example.test", port: 587, secure: false },
      botIds: [],
      createdAt: "2026-11-15T00:00:00.000Z",
    };
    mailboxes.push(created);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ json: created }),
    });
  });

  await openUserSettings(page, "mailboxes");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("app-password");
  await page.getByLabel("IMAP server").fill("imap.example.test");
  await page.getByLabel("SMTP server").fill("smtp.example.test:587");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByText("owner@example.test").first()).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await captureScreenshot(page, testInfo, "mailboxes-connected");
});
