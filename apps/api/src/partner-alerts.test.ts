import type { PartnerAlertDigest } from "@corvo/db";
import { describe, expect, it } from "vitest";
import {
  PARTNER_ALERT_COPY,
  PARTNER_ALERT_LOCALES,
  partnerAlertLocale,
} from "./partner-alert-copy.js";
import { partnerAlertEmail } from "./partner-alert-email.js";

const ORIGIN = "https://app.example.test";
const digest = (overrides: Partial<PartnerAlertDigest> = {}): PartnerAlertDigest => ({
  to: "owner@example.test",
  locale: null,
  partner: { id: "p1", name: "Acme", currency: "BRL" },
  items: [{ kind: "customer.credit_limit_reached", count: 1, names: ["Barbearia Lima"] }],
  path: "/app/partner/p1/customers?customer=t1",
  ...overrides,
});

describe("partner alert email", () => {
  it("is short, in Portuguese for a Brazilian partner, with one button to the right screen", async () => {
    const message = await partnerAlertEmail(ORIGIN, digest());
    expect(message.to).toBe("owner@example.test");
    expect(message.subject).toBe("Acme: Barbearia Lima atingiu o limite mensal.");
    expect(message.text).toContain("Barbearia Lima atingiu o limite mensal.");
    expect(message.html).toContain(`href="${ORIGIN}/app/partner/p1/customers?customer=t1"`);
    expect(message.html.match(/<a /g)).toHaveLength(1);
  });

  it("speaks English to a partner that is not Brazilian, and the person's language when known", async () => {
    const english = await partnerAlertEmail(
      ORIGIN,
      digest({ partner: { id: "p1", name: "Acme", currency: "USD" } }),
    );
    expect(english.subject).toBe("Acme: Barbearia Lima reached its monthly limit.");
    const german = await partnerAlertEmail(ORIGIN, digest({ locale: "de" }));
    expect(german.text).toContain("Barbearia Lima hat das Monatslimit erreicht.");
  });

  it("folds a burst into one line with a count and a few names", async () => {
    const message = await partnerAlertEmail(
      ORIGIN,
      digest({
        items: [
          { kind: "customer.credit_limit_reached", count: 20, names: ["A", "B", "C"] },
          { kind: "partner.balance_low", count: 1, names: [] },
        ],
      }),
    );
    expect(message.subject).toBe("Acme: 21 avisos");
    expect(message.text).toContain("20 clientes atingiram o limite mensal: A, B, C");
    expect(message.text).toContain("Seu fundo de créditos está acabando.");
  });

  it("says only what the digest holds: counts and customer names", async () => {
    const message = await partnerAlertEmail(ORIGIN, digest());
    expect(message.text).toBe(
      [
        "Rook",
        "Acme",
        "Barbearia Lima atingiu o limite mensal.",
        `Abrir ${ORIGIN}/app/partner/p1/customers?customer=t1`,
        "Você recebe este aviso por gerenciar Acme. Dá para desativar esses e-mails em Integração.",
      ].join("\n\n"),
    );
  });

  it.each(PARTNER_ALERT_LOCALES)("has every line in %s", (locale) => {
    const copy = PARTNER_ALERT_COPY[locale];
    expect(Object.keys(copy.lines)).toHaveLength(7);
    for (const line of Object.values(copy.lines)) {
      for (const text of typeof line === "string" ? [line] : [line.one, line.many]) {
        expect(text.length).toBeGreaterThan(5);
      }
    }
    expect(copy.note).toContain("{partner}");
    expect(copy.several).toContain("{n}");
  });

  it("picks a language from the app's, then from the partner's market", () => {
    expect(partnerAlertLocale("pt", "USD")).toBe("pt-BR");
    expect(partnerAlertLocale("zh-TW", "USD")).toBe("zh-CN");
    expect(partnerAlertLocale("fr-CA", "BRL")).toBe("fr");
    expect(partnerAlertLocale("ko", "BRL")).toBe("pt-BR");
    expect(partnerAlertLocale(null, "USD")).toBe("en");
  });
});
