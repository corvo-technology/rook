import { describe, expect, it } from "vitest";
import {
  billingConfirmationEmail,
  billingEmailLocale,
  planChargeCents,
  renewalReminderEmail,
} from "./billing-email.js";
import { BILLING_EMAIL_COPY } from "./billing-email-copy.js";
import { PARTNER_ALERT_LOCALES } from "./partner-alert-copy.js";

const context = { webOrigin: "https://app.example.test", termsUrl: "https://example.test/terms/" };
const renewsAt = new Date("2027-11-19T12:00:00.000Z");

const confirmation = {
  to: "owner@example.test",
  locale: null,
  plan: "team" as const,
  currency: "brl" as const,
  interval: "year" as const,
  people: 10,
  chargedCents: 235_900,
  aiUseCents: 2000 as const,
  renewsAt,
  renewalCents: 235_900,
  changed: false,
};

describe("plan charge", () => {
  it("adds the plan, the people above the included ones and the AI add-on", () => {
    expect(
      planChargeCents({
        plan: "team",
        currency: "usd",
        interval: "month",
        people: 10,
        aiUseCents: null,
      }),
    ).toBe(3900);
    expect(
      planChargeCents({
        plan: "team",
        currency: "usd",
        interval: "month",
        people: 12,
        aiUseCents: 1000,
      }),
    ).toBe(3900 + 2 * 300 + 1200);
    expect(
      planChargeCents({
        plan: "personal",
        currency: "brl",
        interval: "year",
        people: 1,
        aiUseCents: null,
      }),
    ).toBe(89_900);
  });
});

describe("confirmation email", () => {
  it("states the plan, the amount in its currency, the renewal date, how to cancel and the terms", async () => {
    const message = await billingConfirmationEmail(context, { ...confirmation, locale: "pt-BR" });
    expect(message.to).toBe("owner@example.test");
    expect(message.subject).toBe("Seu plano Equipe está ativo");
    expect(message.text).toContain("Plano: Equipe, cobrança anual");
    expect(message.text).toContain("Pessoas: 10");
    expect(message.text).toMatch(/Cobrado: R\$\s2\.359,00/);
    expect(message.text).toMatch(/IA: US\$\s20,00 de uso por mês/);
    expect(message.text).toMatch(/Próxima renovação: 19 de novembro de 2027, R\$\s2\.359,00/);
    expect(message.text).toContain("cancelar quando quiser");
    expect(message.text).toContain("Termos: https://example.test/terms/");
    expect(message.html).toContain('href="https://app.example.test/settings/billing"');
  });

  it("speaks English by default and formats dollars", async () => {
    const message = await billingConfirmationEmail(context, {
      ...confirmation,
      currency: "usd",
      chargedCents: 39_000,
      renewalCents: 39_000,
      aiUseCents: null,
    });
    expect(message.subject).toBe("Your Team plan is active");
    expect(message.text).toContain("Charged: $390.00");
    expect(message.text).toContain("Next renewal: November 19, 2027, $390.00");
    expect(message.text).not.toContain("AI:");
  });

  it("words a change, and leaves out the charge when it was billed as a difference", async () => {
    const message = await billingConfirmationEmail(context, {
      ...confirmation,
      changed: true,
      chargedCents: null,
    });
    expect(message.subject).toBe("Your plan is now Team");
    expect(message.text).not.toContain("Charged");
  });
});

describe("renewal reminder email", () => {
  it("names the date and the amount and says how to cancel before it", async () => {
    const message = await renewalReminderEmail(context, {
      to: "owner@example.test",
      locale: "es",
      plan: "personal",
      currency: "usd",
      renewsAt,
      amountCents: 15_000,
    });
    expect(message.subject).toBe("Tu plan anual se renueva el 19 de noviembre de 2027");
    expect(message.text).toContain("se cobrarán 150,00");
    expect(message.text).toContain("cancela antes de esa fecha");
    expect(message.text).toContain("Términos: https://example.test/terms/");
  });
});

describe("languages", () => {
  it("falls back to English and follows the app language", () => {
    expect(billingEmailLocale(null)).toBe("en");
    expect(billingEmailLocale("it")).toBe("en");
    expect(billingEmailLocale("pt")).toBe("pt-BR");
    expect(billingEmailLocale("de-AT")).toBe("de");
  });

  it.each(PARTNER_ALERT_LOCALES)("has every line in %s", async (locale) => {
    const copy = BILLING_EMAIL_COPY[locale];
    for (const text of [
      ...Object.values(copy.plans),
      ...Object.values(copy.interval),
      copy.activeSubject,
      copy.changedSubject,
      copy.plan,
      copy.people,
      copy.charged,
      copy.ai,
      copy.renewal,
      copy.cancel,
      copy.manage,
      copy.terms,
      copy.reminderSubject,
      copy.reminderCharge,
      copy.reminderCancel,
    ])
      expect(text.length).toBeGreaterThan(1);
    const message = await billingConfirmationEmail(context, { ...confirmation, locale });
    expect(message.text).not.toMatch(/\{\w+\}/);
    expect(message.text).toContain("2027");
  });
});
