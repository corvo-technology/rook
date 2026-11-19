import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const partner = {
  id: "partner-wl",
  slug: "acme",
  name: "Acme",
  mode: "white_label",
  currency: "BRL",
  accent: null,
  chiefName: null,
};

const brand = {
  appName: "Acme",
  accent: "#2563eb",
  supportEmail: "ajuda@acme.example.test",
  termsUrl: "https://acme.example.test/termos",
  privacyUrl: "https://acme.example.test/privacidade",
  logoUrl: null,
  iconUrl: null,
};

const sender = {
  domain: "mail.acme.example.test",
  state: "pending",
  records: [
    {
      type: "MX",
      name: "send.mail.acme.example.test",
      value: "feedback-smtp.example.test",
      status: "pending",
    },
    {
      type: "TXT",
      name: "send.mail.acme.example.test",
      value: "v=spf1 include:example.test ~all",
      status: "pending",
    },
  ],
  error: null,
};

const branding = {
  brand,
  domainsAvailable: true,
  domain: {
    hostname: "app.acme.example.test",
    state: "pending",
    cname: { name: "app.acme.example.test", target: "fallback.rook.example" },
    nextStep: "add_cname",
    error: null,
  },
  senderAvailable: true,
  sender,
};

test("The white label partner edits the brand and sets up a domain", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `partner-brand-${stamp}@corvo.test`, "password12", `Partner ${stamp}`);
  await completeOnboarding(page);
  await page.route("**/rpc/partnerConsole/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const answers: Record<string, unknown> = { partners: [partner], branding };
    return route.fulfill({ json: { json: answers[name] ?? null } });
  });

  await page.goto("/app/home");
  const nav = page.getByTestId("sidebar-partnership");
  await expect(nav).toBeVisible();

  await nav.getByTestId("sidebar-partner-brand").click();
  const form = page.getByTestId("partner-brand");
  await expect(form.getByLabel("Name")).toHaveValue("Acme");
  await form.getByLabel("Name").fill("Acme Pro");
  await expect(page.getByTestId("brand-preview")).toContainText("Acme Pro");
  await captureScreenshot(page, testInfo, "partner-brand");

  await nav.getByTestId("sidebar-partner-domain").click();
  const domain = page.getByTestId("domain-panel");
  await expect(domain).toContainText("app.acme.example.test");
  await expect(domain).toContainText("fallback.rook.example");
  await expect(page.getByTestId("sender-panel")).toContainText("mail.acme.example.test");
  await captureScreenshot(page, testInfo, "partner-domain");
});

test("A partner's host shows its own brand on the sign-in page and none of Rook's", async ({
  page,
}) => {
  await page.route("**/api/brand", (route) =>
    route.fulfill({
      json: {
        brand: {
          name: "Acme",
          accent: "#2563eb",
          logoUrl: null,
          iconUrl: null,
          supportEmail: null,
          termsUrl: brand.termsUrl,
          privacyUrl: brand.privacyUrl,
        },
      },
    }),
  );
  await page.goto("/sign-in");
  await expect(page.getByTestId("auth-brand")).toHaveText("Acme");
  await expect(page.getByTestId("auth-legal")).toBeVisible();
  await expect(page).toHaveTitle("Acme");
  await expect(page.locator("body")).not.toContainText(/rook/i);
});
