import { describe, expect, it } from "vitest";
import {
  accountDeletionEmail,
  invitationEmail,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
  waitlistConfirmationEmail,
  waitlistNotificationEmail,
} from "./email.js";

describe("account email templates", () => {
  const origin = "https://app.example.test";
  const url = "https://app.example.test/verify?token=fake-token&callbackURL=%2Fsign-in";

  it.each([
    ["verification", () => verificationEmail(origin, "user@example.test", url)],
    [
      "password reset",
      () =>
        passwordResetEmail(origin, { id: "user-1", email: "user@example.test", name: "Test" }, url),
    ],
  ] as const)("preserves the exact %s link in HTML and text", async (_name, create) => {
    const message = await create();
    expect(message.to).toBe("user@example.test");
    expect(message.text).toContain(url);
    expect(message.html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
  });

  it.each([signInCodeEmail, accountDeletionEmail])(
    "escapes code content and includes a plain-text fallback",
    async (create) => {
      const message = await create(origin, "user@example.test", "<script>fake-code</script>");
      expect(message.text).toContain("<script>fake-code</script>");
      expect(message.html).toContain("&lt;script&gt;fake-code&lt;/script&gt;");
      expect(message.html).not.toContain("<script>");
      expect(message.html).not.toContain("<a ");
    },
  );

  it("carries the logo and a button on every account email", async () => {
    const message = await verificationEmail(origin, "user@example.test", url);
    expect(message.html).toContain('src="https://app.example.test/icon-192.png"');
    expect(message.html).toContain("Rook");
    expect(message.text).toContain("Verify email");
  });

  it("renders every transactional email through the shared layout", async () => {
    const to = "user@example.test";
    const user = { id: "user-1", email: to, name: "Test" };
    const messages = await Promise.all([
      verificationEmail(origin, to, url),
      signInCodeEmail(origin, to, "123456"),
      passwordResetEmail(origin, user, url),
      accountDeletionEmail(origin, to, "123456"),
      invitationEmail(origin, { to, inviterName: "Ana", spaceName: "Acme", url }),
      waitlistConfirmationEmail(origin, to, "pt-BR"),
      waitlistConfirmationEmail(origin, to, "en"),
      waitlistNotificationEmail(origin, to, { company: "Acme", email: "a@b.example" }),
    ]);
    for (const message of messages) {
      expect(message.html).toContain('src="https://app.example.test/icon-192.png"');
      expect(message.html).toContain("border-radius:20px");
      expect(message.text.length).toBeGreaterThan(0);
    }
  });

  it("speaks of the nuvem in Portuguese, never the cloud", async () => {
    const message = await waitlistConfirmationEmail(
      "https://app.example.test",
      "a@b.example",
      "pt-BR",
    );
    expect(message.text).toContain("nuvem");
    expect(`${message.subject} ${message.text}`).not.toMatch(/cloud/i);
  });
});
