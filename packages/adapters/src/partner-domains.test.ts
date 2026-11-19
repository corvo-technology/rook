import { createMemoryBrandingStore } from "@corvo/db";
import { describe, expect, it } from "vitest";
import { DomainEmulator, EmailDomainEmulator } from "./domain-emulator.js";
import {
  createPartnerDomainReconciler,
  hasLegalLinks,
  nextHostState,
  nextHostStep,
} from "./partner-domains.js";

const host = (
  status: "pending" | "verified" | "active" | "failed",
  error: string | null = null,
) => ({
  id: "1",
  hostname: "app.acme.example.test",
  status,
  error,
});

describe("a hostname's states", () => {
  it.each([
    // current, provider, legal links -> state
    ["pending", host("pending"), true, "pending"],
    ["pending", host("verified"), true, "verified"],
    ["pending", host("active"), true, "active"],
    ["verified", host("active"), false, "verified"],
    ["verified", host("active"), true, "active"],
    ["active", host("pending"), true, "active"],
    ["active", host("verified"), true, "active"],
    ["failed", host("pending"), true, "pending"],
    ["pending", host("failed", "CNAME not found"), true, "failed"],
    ["active", host("failed", "expired"), true, "failed"],
  ] as const)(
    "%s with the provider saying %j (legal links %s) is %s",
    (current, provider, legalLinks, expected) => {
      expect(nextHostState({ current, provider, legalLinks }).state).toBe(expected);
    },
  );

  it("carries the provider's reason when failed, and clears it afterwards", () => {
    expect(
      nextHostState({
        current: "pending",
        provider: host("failed", "CNAME not found"),
        legalLinks: true,
      }),
    ).toEqual({
      state: "failed",
      error: "CNAME not found",
    });
    expect(
      nextHostState({ current: "failed", provider: host("pending"), legalLinks: true }).error,
    ).toBeNull();
  });

  it("fails a hostname the provider no longer knows", () => {
    expect(nextHostState({ current: "active", provider: null, legalLinks: true }).state).toBe(
      "failed",
    );
  });

  it("names one next step per state", () => {
    const row = (state: "pending" | "verified" | "active" | "failed") => ({
      state,
      lastError: null,
    });
    expect(nextHostStep(row("pending"), false)).toBe("add_cname");
    expect(nextHostStep(row("verified"), false)).toBe("add_legal_links");
    expect(nextHostStep(row("verified"), true)).toBe("wait");
    expect(nextHostStep(row("failed"), true)).toBe("fix_error");
    expect(nextHostStep(row("active"), true)).toBe("none");
    expect(nextHostStep(null, true)).toBe("none");
  });

  it("needs both the terms and the privacy link to count as legal links", () => {
    expect(hasLegalLinks({ termsUrl: "https://a.test", privacyUrl: "https://b.test" })).toBe(true);
    expect(hasLegalLinks({ termsUrl: "https://a.test", privacyUrl: null })).toBe(false);
    expect(hasLegalLinks(null)).toBe(false);
  });
});

function setup() {
  const store = createMemoryBrandingStore(
    new Map([["p1", { enabled: true, mode: "white_label" as const }]]),
  );
  const domains = new DomainEmulator();
  const senderDomains = new EmailDomainEmulator();
  let at = new Date("2026-11-18T12:00:00Z");
  const reconcile = createPartnerDomainReconciler({ store, domains, senderDomains, now: () => at });
  return {
    store,
    domains,
    senderDomains,
    reconcile,
    advance(ms: number) {
      at = new Date(at.getTime() + ms);
    },
    async addHost(hostname = "app.acme.example.test") {
      const created = await domains.create(hostname);
      return store.createDomain({ partnerId: "p1", hostname, providerId: created.id });
    },
    brand: (legal: boolean) =>
      store.saveBrand("p1", {
        appName: "Acme",
        accent: null,
        supportEmail: null,
        termsUrl: legal ? "https://acme.example.test/terms" : null,
        privacyUrl: legal ? "https://acme.example.test/privacy" : null,
      }),
    state: async () => (await store.domains("p1"))[0]!,
  };
}

const HOUR = 60 * 60_000;

describe("the domain reconciler", () => {
  it("walks a hostname from pending to active once the certificate is live and the legal links are set", async () => {
    const t = setup();
    await t.brand(false);
    await t.addHost();
    await t.reconcile();
    expect((await t.state()).state).toBe("pending");

    t.domains.set("app.acme.example.test", "verified");
    await t.reconcile();
    expect((await t.state()).state).toBe("verified");

    t.domains.set("app.acme.example.test", "active");
    await t.reconcile();
    // Live at the provider, but not served as a brand until terms and privacy are set.
    expect((await t.state()).state).toBe("verified");
    expect(await t.store.hostBrand("app.acme.example.test")).toBeNull();

    await t.brand(true);
    await t.reconcile();
    const active = await t.state();
    expect(active.state).toBe("active");
    expect(active.activatedAt).toBeInstanceOf(Date);
    expect((await t.store.hostBrand("app.acme.example.test"))?.brand.appName).toBe("Acme");
  });

  it("records a failure with its reason, and recovers when the provider does", async () => {
    const t = setup();
    await t.brand(true);
    await t.addHost();
    t.domains.set("app.acme.example.test", "failed", "CNAME not found");
    await t.reconcile();
    expect(await t.state()).toMatchObject({ state: "failed", lastError: "CNAME not found" });

    // A failed host is looked at again an hour later, not on every pass.
    t.domains.set("app.acme.example.test", "pending");
    await t.reconcile();
    expect((await t.state()).state).toBe("failed");
    t.advance(HOUR);
    await t.reconcile();
    expect(await t.state()).toMatchObject({ state: "pending", lastError: null });
  });

  it("keeps a live host live while the provider renews, and fails one it has dropped", async () => {
    const t = setup();
    await t.brand(true);
    await t.addHost();
    t.domains.set("app.acme.example.test", "active");
    await t.reconcile();
    expect((await t.state()).state).toBe("active");

    t.domains.set("app.acme.example.test", "pending");
    t.advance(6 * HOUR);
    await t.reconcile();
    expect((await t.state()).state).toBe("active");

    t.domains.hostnames.clear();
    t.advance(6 * HOUR);
    await t.reconcile();
    expect((await t.state()).state).toBe("failed");
    expect(await t.store.hostBrand("app.acme.example.test")).toBeNull();
  });

  it("leaves a hostname as it was when the provider cannot be reached", async () => {
    const t = setup();
    await t.brand(true);
    await t.addHost();
    t.domains.set("app.acme.example.test", "verified");
    await t.reconcile();
    t.domains.failNextCalls(1);
    t.domains.set("app.acme.example.test", "active");
    await t.reconcile();
    expect((await t.state()).state).toBe("verified");
    await t.reconcile();
    expect((await t.state()).state).toBe("active");
  });

  it("verifies a sender domain and stops asking once it is verified", async () => {
    const t = setup();
    await t.brand(true);
    const created = await t.senderDomains.create("mail.acme.example.test");
    await t.store.saveSender("p1", {
      senderDomain: created.name,
      senderState: created.status,
      senderProviderId: created.id,
      senderRecords: created.records,
      senderError: null,
      checkedAt: new Date(0),
    });
    await t.reconcile();
    expect((await t.store.brand("p1"))?.senderState).toBe("pending");

    t.senderDomains.set("mail.acme.example.test", "verified");
    await t.reconcile();
    const verified = await t.store.brand("p1");
    expect(verified?.senderState).toBe("verified");
    expect(verified?.senderRecords.every((record) => record.status === "verified")).toBe(true);
    expect(await t.store.openSenders()).toEqual([]);
  });
});
