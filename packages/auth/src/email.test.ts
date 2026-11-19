import { describe, expect, it } from "vitest";
import type { EmailBrand } from "./email.js";
import {
  accountDeletionEmail,
  invitationEmail,
  partnerLeadConfirmationEmail,
  partnerLeadNotificationEmail,
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
      partnerLeadConfirmationEmail(origin, to, "pt-BR"),
      partnerLeadConfirmationEmail(origin, to, "en"),
      partnerLeadNotificationEmail(origin, to, {
        name: "Ana",
        company: "Acme",
        email: "a@b.example",
        partnerType: "embedded",
      }),
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

describe("white label account email", () => {
  const origin = "https://app.acme.example.test";
  const to = "user@example.test";
  const brand: EmailBrand = {
    name: "Acme",
    logoUrl: "https://app.acme.example.test/api/brand/assets/p1/logo-abc.png",
    accent: "#2563eb",
    supportEmail: "help@acme.example.test",
    termsUrl: "https://acme.example.test/terms",
    privacyUrl: "https://acme.example.test/privacy",
  };

  const all = (b?: EmailBrand) =>
    Promise.all([
      verificationEmail(origin, to, `${origin}/verify?token=t`, b),
      signInCodeEmail(origin, to, "123456", b),
      passwordResetEmail(origin, { id: "u1", email: to, name: "Ana" }, `${origin}/reset`, b),
      accountDeletionEmail(origin, to, "123456", b),
      invitationEmail(
        origin,
        { to, inviterName: "Ana", spaceName: "Equipe", url: `${origin}/invite/x` },
        b,
      ),
    ]);

  it("carries the partner's name, logo, colour and legal links, and nothing of Rook's", async () => {
    for (const message of await all(brand)) {
      const everything = `${message.subject} ${message.html} ${message.text}`;
      expect(everything).not.toMatch(/rook/i);
      expect(everything).toContain("Acme");
      expect(message.html).toContain(`src="${brand.logoUrl}"`);
      expect(message.html).toContain("#2563eb");
      expect(message.html).toContain('href="https://acme.example.test/terms"');
      expect(message.html).toContain('href="https://acme.example.test/privacy"');
      expect(message.html).toContain('href="mailto:help@acme.example.test"');
    }
  });

  it("names the partner in every subject", async () => {
    const subjects = (await all(brand)).map((message) => message.subject);
    expect(subjects).toEqual([
      "Verify your Acme email",
      "Your Acme sign-in code",
      "Reset your Acme password",
      "Confirm Acme account deletion",
      "Ana invited you to Equipe on Acme",
    ]);
  });

  it("puts a label on the button that reads on the partner's colour", async () => {
    const dark = await verificationEmail(origin, to, `${origin}/v`, {
      ...brand,
      accent: "#1e3a8a",
    });
    const light = await verificationEmail(origin, to, `${origin}/v`, {
      ...brand,
      accent: "#facc15",
    });
    expect(dark.html).toMatch(/background-color:#1e3a8a;color:#ffffff/);
    expect(light.html).toMatch(/background-color:#facc15;color:#000000/);
  });

  it("shows only a name when the partner has no logo, and no footer when it has no links", async () => {
    const plain = await verificationEmail(origin, to, `${origin}/v`, {
      name: "Acme",
      logoUrl: null,
      accent: null,
      supportEmail: null,
      termsUrl: null,
      privacyUrl: null,
    });
    expect(plain.html).not.toContain("<img");
    expect(plain.html).not.toContain("mailto:");
    expect(plain.html).toContain("Acme");
  });

  it("keeps Rook's own mail exactly as it was when no partner is given", async () => {
    for (const message of await all()) {
      expect(message.html).toContain('src="https://app.acme.example.test/icon-192.png"');
      expect(`${message.subject} ${message.text}`).toMatch(/rook/i);
      expect(message.html).not.toContain("mailto:");
    }
  });

  it("escapes a partner's name like any other content", async () => {
    const message = await signInCodeEmail(origin, to, "123456", { ...brand, name: "<b>Acme</b>" });
    expect(message.html).not.toContain("<b>Acme</b>");
    expect(message.html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
  });
});
