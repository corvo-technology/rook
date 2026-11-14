import type { TransactionalEmail, TransactionalEmailProvider } from "@corvo/adapter-kit";
import type { TestSink } from "@corvo/logging";
import { createLogger, createTestSink, installLogger } from "@corvo/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WaitlistEntryInput, WaitlistStore } from "./waitlist.js";
import {
  WAITLIST_PATH,
  waitlistConfirmationEmail,
  waitlistLocale,
  waitlistRoutes,
} from "./waitlist.js";

const SITE = "https://www.example.test";
const valid = { email: "Ana@Acme.example", company: "Acme", task: "Weekly reports" };

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
  const rows = new Map<string, WaitlistEntryInput & { id: string; notified: boolean }>();
  const store: WaitlistStore = {
    async add(entry) {
      if (rows.has(entry.email)) return null;
      const id = `w${rows.size + 1}`;
      rows.set(entry.email, { ...entry, id, notified: false });
      return { id };
    },
    async markNotified(id) {
      for (const row of rows.values()) if (row.id === id) row.notified = true;
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
  const app = waitlistRoutes({
    store,
    email: options.email === null ? undefined : (options.email ?? mail.provider),
    allowedOrigins: options.origins ?? [SITE],
    notifyEmail: options.notifyEmail,
    clientIp: (c) => c.req.header("x-test-ip") ?? "203.0.113.1",
    now: () => now,
  });
  return { app, rows, sent: mail.sent };
}

function post(
  app: ReturnType<typeof waitlistRoutes>,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(WAITLIST_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("waitlist signup", () => {
  it("stores a lowercased entry, answers ok and sends one confirmation", async () => {
    const { app, rows, sent } = setup();
    const response = await post(app, { ...valid, locale: "en-US" });
    await app.idle();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rows.get("ana@acme.example")).toMatchObject({
      company: "Acme",
      task: "Weekly reports",
      locale: "en",
      notified: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ana@acme.example");
  });

  it("rejects invalid or oversized fields", async () => {
    const { app, rows } = setup();
    const bad = [
      { company: "Acme" },
      { ...valid, email: "not-an-email" },
      { ...valid, email: `${"a".repeat(250)}@x.example` },
      { ...valid, company: "" },
      { ...valid, company: "c".repeat(121) },
      { ...valid, task: "t".repeat(501) },
      "{not json",
    ];
    for (const payload of bad) expect((await post(app, payload)).status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it("refuses a body that is not JSON or is too large", async () => {
    const { app } = setup();
    expect((await post(app, valid, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(app, { ...valid, task: "x".repeat(20_000) })).status).toBe(413);
  });

  it("returns ok and stores nothing when the honeypot is filled", async () => {
    const { app, rows, sent } = setup();
    const response = await post(app, { ...valid, website: "https://spam.example" });
    await app.idle();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rows.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("answers the same for a repeated email and sends no second email", async () => {
    const { app, rows, sent } = setup();
    const first = await post(app, valid);
    await app.idle();
    const second = await post(app, { ...valid, email: "ANA@acme.example", company: "Other" });
    await app.idle();
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    expect(rows.size).toBe(1);
    expect(rows.get("ana@acme.example")?.company).toBe("Acme");
    expect(sent).toHaveLength(1);
  });

  it("still stores the entry and warns when no email provider is configured", async () => {
    const { app, rows } = setup({ email: null });
    const response = await post(app, valid);
    await app.idle();
    expect(response.status).toBe(200);
    expect(rows.get("ana@acme.example")?.notified).toBe(false);
    expect(sink.events.some((event) => event.level === "warn")).toBe(true);
  });

  it("keeps the entry, unnotified, when delivery fails", async () => {
    const { app, rows } = setup({ email: fakeEmail(true).provider });
    expect((await post(app, valid)).status).toBe(200);
    await app.idle();
    expect(rows.get("ana@acme.example")?.notified).toBe(false);
  });

  it("notifies the team inbox with company, email and task", async () => {
    const { app, sent } = setup({ notifyEmail: "team@example.test" });
    await post(app, valid);
    await app.idle();
    expect(sent.map((message) => message.to)).toEqual(["ana@acme.example", "team@example.test"]);
    expect(sent[1]?.text).toContain("Acme");
    expect(sent[1]?.text).toContain("ana@acme.example");
    expect(sent[1]?.text).toContain("Weekly reports");
  });

  it("never writes the address to an info log", async () => {
    const { app } = setup({ notifyEmail: "team@example.test" });
    await post(app, valid);
    await post(app, valid);
    await app.idle();
    const lines = JSON.stringify(sink.events.filter((event) => event.level === "info"));
    expect(lines).not.toContain("acme.example");
    expect(JSON.stringify(sink.events)).not.toContain("ana@acme.example");
  });
});

describe("waitlist email", () => {
  it("is Brazilian Portuguese for pt locales and English otherwise", async () => {
    expect(["pt", "pt-BR", "pt_br", "PT-PT"].map(waitlistLocale)).toEqual([
      "pt-BR",
      "pt-BR",
      "pt-BR",
      "pt-BR",
    ]);
    expect([undefined, "en", "fr-CA", "ptx"].map(waitlistLocale)).toEqual(["en", "en", "en", "en"]);
    const pt = waitlistConfirmationEmail("a@b.example", "pt-BR");
    expect(pt.subject).toBe("Você está na lista do Rook");
    expect(pt.text).toContain("Equipe Rook");
    expect(waitlistConfirmationEmail("a@b.example", "en").subject).not.toBe(pt.subject);
  });

  it("is sent in the person's locale", async () => {
    const { app, sent } = setup();
    await post(app, { ...valid, locale: "pt-BR" });
    await post(app, { ...valid, email: "bob@acme.example", locale: "fr" });
    await app.idle();
    expect(sent.map((message) => message.subject)).toEqual([
      "Você está na lista do Rook",
      "You're on the Rook waitlist",
    ]);
  });
});

describe("waitlist CORS", () => {
  it("answers the preflight for an allowed origin only", async () => {
    const { app } = setup();
    const allowed = await app.request(WAITLIST_PATH, {
      method: "OPTIONS",
      headers: { origin: SITE, "access-control-request-method": "POST" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(allowed.headers.get("access-control-allow-methods")).toContain("POST");
    const other = await app.request(WAITLIST_PATH, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(other.status).toBe(403);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes an allowed origin and refuses other origins without storing", async () => {
    const { app, rows } = setup();
    const ok = await post(app, valid);
    expect(ok.headers.get("access-control-allow-origin")).toBe(SITE);
    const blocked = await post(
      app,
      { ...valid, email: "b@acme.example" },
      { origin: "https://evil.example" },
    );
    expect(blocked.status).toBe(403);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    expect(rows.size).toBe(1);
  });

  it("is off when no origin is configured", async () => {
    const { app, rows } = setup({ origins: [] });
    expect((await post(app, valid)).status).toBe(403);
    expect(rows.size).toBe(0);
  });
});

describe("waitlist rate limit", () => {
  it("limits one address, then recovers after the window", async () => {
    const { app } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await post(app, { ...valid, email: `p${i}@acme.example` })).status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(200));
    expect(statuses.slice(8)).toEqual([429, 429]);
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
