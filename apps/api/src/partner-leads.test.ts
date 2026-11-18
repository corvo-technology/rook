import type { TransactionalEmail, TransactionalEmailProvider } from "@corvo/adapter-kit";
import type { TestSink } from "@corvo/logging";
import { createLogger, createTestSink, installLogger } from "@corvo/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PartnerLeadInput, PartnerLeadStore } from "./partner-leads.js";
import { PARTNER_LEADS_PATH, partnerLeadRoutes } from "./partner-leads.js";

const SITE = "https://www.example.test";
const valid = {
  name: "Ana",
  email: "Ana@Acme.example",
  company: "Acme",
  website: "https://acme.example",
  partnerType: "embedded",
  country: "Brasil",
  customers: "50-200",
  message: "We run a clinic system",
  consent: true,
};

let sink: TestSink;
let now: number;

beforeEach(() => {
  sink = createTestSink();
  installLogger(createLogger({ service: "corvo-api", sinks: [sink] }));
  now = 1_000_000;
});

afterEach(() => {
  installLogger(createLogger({ service: "corvo-api", level: "off", sinks: [] }));
});

function memoryStore() {
  const rows: Array<PartnerLeadInput & { id: string; notified: boolean }> = [];
  const store: PartnerLeadStore = {
    async add(lead) {
      const id = `p${rows.length + 1}`;
      rows.push({ ...lead, id, notified: false });
      return { id };
    },
    async markNotified(id) {
      for (const row of rows) if (row.id === id) row.notified = true;
    },
  };
  return { store, rows };
}

function fakeEmail(fail = false) {
  const sent: TransactionalEmail[] = [];
  const provider: TransactionalEmailProvider = {
    describe: () => ({ id: "fake", capabilities: { transactional: true } }) as never,
    async send(message) {
      if (fail) throw new Error("provider down");
      sent.push(message);
    },
  };
  return { provider, sent };
}

function setup(
  options: {
    email?: TransactionalEmailProvider | null;
    notifyEmail?: string;
    origins?: string[];
  } = {},
) {
  const { store, rows } = memoryStore();
  const mail = fakeEmail();
  const app = partnerLeadRoutes({
    store,
    webOrigin: "https://app.example.test",
    email: options.email === null ? undefined : (options.email ?? mail.provider),
    allowedOrigins: options.origins ?? [SITE],
    notifyEmail: options.notifyEmail,
    clientIp: (c) => c.req.header("x-test-ip") ?? "203.0.113.1",
    now: () => now,
  });
  return { app, rows, sent: mail.sent };
}

function post(
  app: ReturnType<typeof partnerLeadRoutes>,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(PARTNER_LEADS_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("partner lead", () => {
  it("stores a normalized lead, answers ok and sends the confirmation", async () => {
    const { app, rows, sent } = setup();
    const response = await post(app, { ...valid, locale: "pt-BR" });
    await app.idle();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Ana",
      email: "ana@acme.example",
      partnerType: "embedded",
      customers: "50-200",
      locale: "pt-BR",
      notified: true,
    });
    expect(rows[0]).not.toHaveProperty("consent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ana@acme.example");
    expect(sent[0]?.subject).toBe("Recebemos o seu interesse em ser parceiro do Rook");
  });

  it("sends English to every other locale", async () => {
    const { app, sent } = setup();
    await post(app, { ...valid, locale: "de" });
    await app.idle();
    expect(sent[0]?.subject).toBe("We got your Rook partner request");
  });

  it("accepts only the required fields", async () => {
    const { app, rows } = setup();
    const response = await post(app, {
      name: "Ana",
      email: "a@acme.example",
      company: "Acme",
      partnerType: "unsure",
      consent: true,
    });
    expect(response.status).toBe(200);
    expect(rows[0]?.website).toBeUndefined();
  });

  it("rejects invalid, oversized or unconsented fields", async () => {
    const { app, rows } = setup();
    const bad = [
      { ...valid, name: "" },
      { ...valid, email: "not-an-email" },
      { ...valid, company: "c".repeat(121) },
      { ...valid, partnerType: "reseller" },
      { ...valid, customers: "many" },
      { ...valid, message: "m".repeat(2001) },
      { ...valid, consent: false },
      { ...valid, consent: undefined },
      "{not json",
    ];
    for (const [i, payload] of bad.entries()) {
      expect((await post(app, payload, { "x-test-ip": `192.0.2.${i}` })).status).toBe(400);
    }
    expect(rows).toHaveLength(0);
  });

  it("refuses a body that is not JSON or is too large", async () => {
    const { app } = setup();
    expect((await post(app, valid, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(app, { ...valid, message: "x".repeat(40_000) })).status).toBe(413);
  });

  it("returns ok and stores nothing when the honeypot is filled", async () => {
    const { app, rows, sent } = setup();
    const response = await post(app, { ...valid, hp: "https://spam.example" });
    await app.idle();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rows).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("still stores the lead and warns when no email provider is configured", async () => {
    const { app, rows } = setup({ email: null });
    expect((await post(app, valid)).status).toBe(200);
    await app.idle();
    expect(rows[0]?.notified).toBe(false);
    expect(sink.events.some((event) => event.level === "warn")).toBe(true);
  });

  it("keeps the lead, unnotified, when delivery fails", async () => {
    const { app, rows } = setup({ email: fakeEmail(true).provider });
    expect((await post(app, valid)).status).toBe(200);
    await app.idle();
    expect(rows[0]?.notified).toBe(false);
  });

  it("never writes the address to a log", async () => {
    const { app } = setup({ notifyEmail: "team@example.test" });
    await post(app, valid);
    await app.idle();
    expect(JSON.stringify(sink.events)).not.toContain("acme.example");
  });
});

describe("partner lead emails", () => {
  it("notifies the team inbox with every field, escaping the lead's text", async () => {
    const { app, sent } = setup({ notifyEmail: "team@example.test" });
    await post(app, { ...valid, message: "<script>alert(1)</script>" });
    await app.idle();
    expect(sent.map((message) => message.to)).toEqual(["ana@acme.example", "team@example.test"]);
    const notice = sent[1];
    for (const value of ["Ana", "Acme", "https://acme.example", "embedded", "Brasil", "50-200"]) {
      expect(notice?.text).toContain(value);
    }
    expect(notice?.html).not.toContain("<script>alert(1)</script>");
    expect(notice?.html).toContain("&lt;script&gt;");
  });

  it("renders the branded layout in both languages", async () => {
    const { app, sent } = setup();
    await post(app, { ...valid, locale: "pt" });
    await post(app, { ...valid, email: "b@acme.example", locale: "en" });
    await app.idle();
    for (const message of sent) {
      expect(message.html).toContain('src="https://app.example.test/icon-192.png"');
      expect(message.text.length).toBeGreaterThan(0);
    }
    expect(sent[0]?.html).toContain('lang="pt-BR"');
    expect(sent[1]?.html).toContain('lang="en"');
  });
});

describe("partner lead CORS", () => {
  it("answers the preflight for an allowed origin only", async () => {
    const { app } = setup();
    const allowed = await app.request(PARTNER_LEADS_PATH, {
      method: "OPTIONS",
      headers: { origin: SITE, "access-control-request-method": "POST" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(SITE);
    const other = await app.request(PARTNER_LEADS_PATH, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(other.status).toBe(403);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes an allowed origin and refuses others without storing", async () => {
    const { app, rows } = setup();
    expect((await post(app, valid)).headers.get("access-control-allow-origin")).toBe(SITE);
    const blocked = await post(app, valid, { origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("is off when no origin is configured", async () => {
    const { app, rows } = setup({ origins: [] });
    expect((await post(app, valid)).status).toBe(403);
    expect(rows).toHaveLength(0);
  });
});

describe("partner lead rate limit", () => {
  it("limits one address, then recovers after the window", async () => {
    const { app } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await post(app, { ...valid, email: `p${i}@acme.example` })).status);
    }
    expect(statuses).toEqual([...Array(8).fill(200), 429, 429]);
    now += 10 * 60_000 + 1;
    expect((await post(app, { ...valid, email: "later@acme.example" })).status).toBe(200);
  });

  it("limits one email across addresses", async () => {
    const { app } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await post(app, valid, { "x-test-ip": `198.51.100.${i}` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});
