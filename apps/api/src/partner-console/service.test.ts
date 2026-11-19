import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createDeps,
  createFakeStore,
  customerRow,
  NOW,
  partnerRecord,
} from "./fake-store.test-support.js";
import { csvCell, formatMinor, lastPeriods, statementCsv } from "./format.js";
import {
  getCustomer,
  getEvents,
  getIntegration,
  getOverview,
  getPricing,
  getRevenue,
  getRevenueCsv,
  getTemplate,
  listCustomers,
  listPartners,
  openSupportSession,
  rotateIntegrationKey,
  runCustomerAction,
  setIntegrationAlertEmail,
  setIntegrationWebhook,
  setPricing,
  setTemplate,
} from "./service.js";
import { PartnerConsoleError } from "./types.js";

const ORG_A = { organizationId: "org-a", actorUserId: "user-a" };
const ORG_B = { organizationId: "org-b", actorUserId: "user-b" };

function world() {
  const fake = createFakeStore({
    members: { pa1: ["org-a"], pa2: ["org-a"], pb: ["org-b"] },
    partners: [
      partnerRecord("pa1"),
      partnerRecord("pa2", { currency: "USD", name: "Second product" }),
      partnerRecord("pb"),
    ],
    customers: {
      pa1: [
        customerRow("c1", { name: "Alpha Clinic", since: new Date("2026-11-02T00:00:00Z") }),
        customerRow("c2", {
          name: "Beta Salon",
          lowCredit: true,
          creditUsedPct: 85,
          since: new Date("2026-10-20T00:00:00Z"),
        }),
        customerRow("c3", {
          name: "Gamma Studio",
          state: "past_due",
          pastDueSince: new Date("2026-11-10T00:00:00Z"),
          since: new Date("2026-10-10T00:00:00Z"),
        }),
        customerRow("c4", {
          name: "Delta Paused",
          state: "paused",
          lowCredit: true,
          since: new Date("2026-09-01T00:00:00Z"),
        }),
        customerRow("c5", {
          name: "Epsilon Down",
          connector: "down",
          since: new Date("2026-08-01T00:00:00Z"),
        }),
      ],
      pb: [customerRow("b1", { name: "Other org customer" })],
    },
    revenue: {
      pa1: [
        {
          id: "r1",
          createdAt: new Date("2026-11-03T10:00:00Z"),
          tenantId: "c1",
          tenantName: "Alpha Clinic",
          kind: "subscription",
          baseMinor: 49900,
          rookShareMinor: 39920,
          partnerCommissionMinor: 9980,
          markupMinor: 7485,
          paidMinor: 57385,
        },
        {
          id: "r2",
          createdAt: new Date("2026-11-05T10:00:00Z"),
          tenantId: "c2",
          tenantName: '=HYPERLINK("x"),"Beta"',
          kind: "topup",
          baseMinor: 5000,
          rookShareMinor: 4000,
          partnerCommissionMinor: 1000,
          markupMinor: 700,
          paidMinor: 5700,
        },
        {
          id: "r3",
          createdAt: new Date("2026-10-05T10:00:00Z"),
          tenantId: "c2",
          tenantName: "Beta Salon",
          kind: "subscription",
          baseMinor: 10000,
          rookShareMinor: 8000,
          partnerCommissionMinor: 2000,
          markupMinor: 0,
          paidMinor: 10000,
        },
      ],
    },
    invoices: {
      pa1: [
        {
          id: "inv1",
          period: "2026-10",
          state: "issued",
          totalMinor: 8000,
          issuedAt: new Date("2026-11-05T00:00:00Z"),
        },
      ],
    },
  });
  return { ...fake, deps: createDeps(fake.store) };
}

describe("tenant isolation", () => {
  it("lists only the partners the organization belongs to", async () => {
    const { deps } = world();
    expect((await listPartners(deps, ORG_A)).map((partner) => partner.id)).toEqual(["pa1", "pa2"]);
    expect((await listPartners(deps, ORG_B)).map((partner) => partner.id)).toEqual(["pb"]);
    expect(await listPartners(deps, { organizationId: "org-nobody" })).toEqual([]);
  });

  it("answers every read about another organization's partner as not found", async () => {
    const { deps } = world();
    const reads = [
      () => getOverview(deps, ORG_A, { partnerId: "pb" }),
      () => listCustomers(deps, ORG_A, { partnerId: "pb" }),
      () => getCustomer(deps, ORG_A, { partnerId: "pb", tenantId: "b1" }),
      () => getPricing(deps, ORG_A, { partnerId: "pb" }),
      () => getRevenue(deps, ORG_A, { partnerId: "pb", period: "2026-11" }),
      () => getRevenueCsv(deps, ORG_A, { partnerId: "pb", period: "2026-11" }),
      () => getIntegration(deps, ORG_A, { partnerId: "pb" }),
      () => getEvents(deps, ORG_A, { partnerId: "pb" }),
      () => getTemplate(deps, ORG_A, { partnerId: "pb" }),
      () => getOverview(deps, ORG_A, { partnerId: "does-not-exist" }),
    ];
    for (const read of reads) {
      await expect(read()).rejects.toMatchObject({ code: "not_found", reason: "not_found" });
    }
  });

  it("refuses every write on another organization's partner and changes nothing", async () => {
    const { deps, writes, audit, credits, codes } = world();
    const writesTried = [
      () =>
        runCustomerAction(deps, ORG_A, {
          partnerId: "pb",
          tenantId: "b1",
          action: "pause",
          idempotencyKey: "key-12345678",
        }),
      () =>
        runCustomerAction(deps, ORG_A, {
          partnerId: "pb",
          tenantId: "b1",
          action: "add_credit",
          amountMinor: 1000,
          idempotencyKey: "key-12345679",
        }),
      () => openSupportSession(deps, ORG_A, { partnerId: "pb", tenantId: "b1" }),
      () =>
        setPricing(deps, ORG_A, {
          partnerId: "pb",
          checkoutUrl: "https://pay.example.test",
          markups: [{ itemId: "plan:team", kind: "fixed", value: 100 }],
        }),
      () => rotateIntegrationKey(deps, ORG_A, { partnerId: "pb" }),
      () =>
        setIntegrationWebhook(deps, ORG_A, { partnerId: "pb", url: "https://hook.example.test" }),
      () => setTemplate(deps, ORG_A, { partnerId: "pb", template: { agents: [] } }),
    ];
    for (const write of writesTried) {
      await expect(write()).rejects.toMatchObject({ code: "not_found" });
    }
    expect(writes).toEqual({ markups: 0, state: 0, key: 0, webhook: 0, checkout: 0, template: 0 });
    expect([audit.length, credits.length, codes.length]).toEqual([0, 0, 0]);
  });

  it("never finds a customer of another partner through a partner of this organization", async () => {
    const { deps } = world();
    await expect(
      getCustomer(deps, ORG_A, { partnerId: "pa1", tenantId: "b1" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      runCustomerAction(deps, ORG_A, {
        partnerId: "pa1",
        tenantId: "b1",
        action: "pause",
        idempotencyKey: "key-12345678",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns numbers and states only: no customer content in a customer's detail", async () => {
    const { deps } = world();
    const detail = await getCustomer(deps, ORG_A, { partnerId: "pa1", tenantId: "c1" });
    expect(Object.keys(detail).sort()).toEqual(
      [
        "agents",
        "balance",
        "connector",
        "creditRemaining",
        "creditUsedPct",
        "name",
        "plan",
        "priceMinor",
        "runs30d",
        "since",
        "state",
        "tenantId",
      ].sort(),
    );
  });
});

describe("pricing and markup", () => {
  it("computes base, commission, markup and the final price in BRL minor units", async () => {
    const { deps } = world();
    const pricing = await setPricing(deps, ORG_A, {
      partnerId: "pa1",
      markups: [
        { itemId: "plan:team", kind: "percent", value: 1500 },
        { itemId: "pack:pack_s", kind: "fixed", value: 700 },
      ],
    });
    expect(pricing.currency).toBe("BRL");
    expect(pricing.commissionBps).toBe(2000);
    expect(pricing.plans[0]).toMatchObject({
      itemId: "plan:team",
      planId: "team",
      baseMinor: 49900,
      commissionMinor: 9980,
      // 15% of 49900 is 7485 exactly.
      markupMinor: 7485,
      finalMinor: 57385,
      markup: { kind: "percent", value: 1500 },
    });
    expect(pricing.packs[0]).toMatchObject({
      baseMinor: 5000,
      commissionMinor: 1000,
      markupMinor: 700,
      finalMinor: 5700,
    });
  });

  it("rounds a percent markup down in USD cents and leaves an unset item at its base", async () => {
    const { deps } = world();
    const pricing = await setPricing(deps, ORG_A, {
      partnerId: "pa2",
      markups: [{ itemId: "plan:solo", kind: "percent", value: 333 }],
    });
    expect(pricing.currency).toBe("USD");
    // 2900 x 333 / 10000 = 96.57, rounded down to 96 cents.
    expect(pricing.plans[1]).toMatchObject({
      baseMinor: 2900,
      commissionMinor: 580,
      markupMinor: 96,
      finalMinor: 2996,
    });
    expect(pricing.plans[0]).toMatchObject({ markupMinor: 0, finalMinor: 49900 });
    expect(pricing.plans[0]?.markup).toEqual({ kind: "fixed", value: 0 });
  });

  it("removes a markup set to zero and keeps the others", async () => {
    const { deps } = world();
    await setPricing(deps, ORG_A, {
      partnerId: "pa1",
      markups: [
        { itemId: "plan:team", kind: "fixed", value: 1000 },
        { itemId: "plan:solo", kind: "fixed", value: 100 },
      ],
    });
    const pricing = await setPricing(deps, ORG_A, {
      partnerId: "pa1",
      markups: [{ itemId: "plan:team", kind: "fixed", value: 0 }],
    });
    expect(pricing.plans.map((plan) => plan.markupMinor)).toEqual([0, 100]);
  });

  it("refuses a markup over the base, an unknown item and a repeated item", async () => {
    const { deps, writes } = world();
    const bad = [
      [{ itemId: "plan:solo", kind: "fixed" as const, value: 2901 }],
      [{ itemId: "plan:team", kind: "percent" as const, value: 10_001 }],
      [{ itemId: "plan:nope", kind: "fixed" as const, value: 1 }],
      [{ itemId: "team", kind: "fixed" as const, value: 1 }],
      [
        { itemId: "plan:team", kind: "fixed" as const, value: 1 },
        { itemId: "plan:team", kind: "fixed" as const, value: 2 },
      ],
    ];
    for (const markups of bad) {
      await expect(setPricing(deps, ORG_A, { partnerId: "pa1", markups })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    expect(writes.markups).toBe(0);
  });

  it("accepts a markup of exactly 100% of the base", async () => {
    const { deps } = world();
    const pricing = await setPricing(deps, ORG_A, {
      partnerId: "pa1",
      markups: [
        { itemId: "plan:solo", kind: "fixed", value: 2900 },
        { itemId: "plan:team", kind: "percent", value: 10_000 },
      ],
    });
    expect(pricing.plans.map((plan) => plan.finalMinor)).toEqual([99800, 5800]);
  });

  it("validates the checkout address and audits a pricing change without the address", async () => {
    const { deps, audit } = world();
    await expect(
      setPricing(deps, ORG_A, {
        partnerId: "pa1",
        checkoutUrl: "http://pay.example.test",
        markups: [],
      }),
    ).rejects.toMatchObject({ code: "invalid", reason: "checkoutUrl" });
    const pricing = await setPricing(deps, ORG_A, {
      partnerId: "pa1",
      checkoutUrl: "https://pay.example.test/{tenant}",
      markups: [{ itemId: "plan:team", kind: "fixed", value: 500 }],
    });
    expect(pricing.checkoutUrl).toBe("https://pay.example.test/{tenant}");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      kind: "pricing.changed",
      actorUserId: "user-a",
      detail: {
        markups: [{ item: "plan:team", kind: "fixed", value: 500 }],
        checkoutUrlChanged: true,
      },
    });
    expect(JSON.stringify(audit[0])).not.toContain("pay.example.test");
  });

  it("keeps an existing subscription at its sold price until the period ends", async () => {
    const { deps, store } = world();
    const row = customerRow("sub", {
      name: "Subscriber",
      subscription: {
        baseMinor: 49900,
        markupMinor: 0,
        periodEnd: new Date("2026-12-01T00:00:00Z"),
      },
    });
    (await store.customerRows(partnerRecord("pa1"), NOW)).push(row);
    await setPricing(deps, ORG_A, {
      partnerId: "pa1",
      markups: [{ itemId: "plan:team", kind: "fixed", value: 5000 }],
    });
    // The new price is 54900, but this customer renews on 2026-12-01 and keeps 49900 until then.
    const before = await getCustomer(deps, ORG_A, { partnerId: "pa1", tenantId: "sub" });
    expect(before.priceMinor).toBe(49900);
    const renewed = await getCustomer(
      { ...deps, now: () => new Date("2026-12-01T00:00:00Z") },
      ORG_A,
      { partnerId: "pa1", tenantId: "sub" },
    );
    expect(renewed.priceMinor).toBe(54900);
  });
});

describe("customer actions", () => {
  const credit = (key: string, amountMinor = 2500) => ({
    partnerId: "pa1",
    tenantId: "c1",
    action: "add_credit" as const,
    amountMinor,
    idempotencyKey: key,
  });

  it("adds credit once per idempotency key and answers a repeat as the first call did", async () => {
    const { deps, credits, audit } = world();
    const first = await runCustomerAction(deps, ORG_A, credit("key-aaaaaaaa"));
    expect(first).toEqual({ state: "active", creditRemaining: 20500, replayed: false });
    const again = await runCustomerAction(deps, ORG_A, credit("key-aaaaaaaa"));
    expect(again).toEqual({ state: "active", creditRemaining: 20500, replayed: true });
    expect(credits).toEqual([{ tenantId: "c1", amountMinor: 2500, key: "key-aaaaaaaa" }]);
    expect(audit.filter((event) => event.kind === "customer.credit_added")).toEqual([
      expect.objectContaining({
        actorUserId: "user-a",
        tenantId: "c1",
        detail: { amountMinor: 2500, currency: "BRL" },
      }),
    ]);
  });

  it("refuses another request under a used key and adds nothing", async () => {
    const { deps, credits } = world();
    await runCustomerAction(deps, ORG_A, credit("key-bbbbbbbb"));
    await expect(
      runCustomerAction(deps, ORG_A, credit("key-bbbbbbbb", 9999)),
    ).rejects.toMatchObject({
      code: "conflict",
      reason: "idempotency_conflict",
    });
    expect(credits).toHaveLength(1);
  });

  it("adds credit again under a new key", async () => {
    const { deps, credits } = world();
    await runCustomerAction(deps, ORG_A, credit("key-cccccccc"));
    const second = await runCustomerAction(deps, ORG_A, credit("key-dddddddd"));
    expect(second.creditRemaining).toBe(23000);
    expect(credits).toHaveLength(2);
  });

  it("needs an amount for add_credit and refuses one for anything else", async () => {
    const { deps } = world();
    await expect(
      runCustomerAction(deps, ORG_A, {
        partnerId: "pa1",
        tenantId: "c1",
        action: "add_credit",
        idempotencyKey: "key-eeeeeeee",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      runCustomerAction(deps, ORG_A, {
        partnerId: "pa1",
        tenantId: "c1",
        action: "pause",
        amountMinor: 5,
        idempotencyKey: "key-ffffffff",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses credit for a paused customer", async () => {
    const { deps, credits } = world();
    await expect(
      runCustomerAction(deps, ORG_A, { ...credit("key-gggggggg"), tenantId: "c4" }),
    ).rejects.toMatchObject({ code: "refused", reason: "tenant_suspended" });
    expect(credits).toHaveLength(0);
  });

  it("pauses and resumes, audited, and a replayed pause audits once", async () => {
    const { deps, audit } = world();
    const base = { partnerId: "pa1", tenantId: "c1" };
    expect(
      await runCustomerAction(deps, ORG_A, {
        ...base,
        action: "pause",
        idempotencyKey: "key-hhhhhhhh",
      }),
    ).toMatchObject({ state: "paused", replayed: false });
    expect(
      await runCustomerAction(deps, ORG_A, {
        ...base,
        action: "pause",
        idempotencyKey: "key-hhhhhhhh",
      }),
    ).toMatchObject({ state: "paused", replayed: true });
    expect(
      await runCustomerAction(deps, ORG_A, {
        ...base,
        action: "resume",
        idempotencyKey: "key-iiiiiiii",
      }),
    ).toMatchObject({ state: "active", replayed: false });
    expect(audit.map((event) => event.kind)).toEqual(["customer.paused", "customer.resumed"]);
  });
});

describe("support session", () => {
  it("returns a one-use address, stores only the code's hash and audits who opened it", async () => {
    const { deps, codes, audit } = world();
    const session = await openSupportSession(deps, ORG_A, { partnerId: "pa1", tenantId: "c1" });
    expect(session.url).toBe("https://app.example.test/api/partner/enter?code=code-1");
    expect(session.expiresAt).toBe("2026-11-18T12:01:00.000Z");
    expect(codes).toEqual([
      {
        partnerId: "pa1",
        tenantId: "c1",
        codeHash: createHash("sha256").update("code-1").digest("hex"),
        actorUserId: "user-a",
        expiresAt: new Date("2026-11-18T12:01:00.000Z"),
      },
    ]);
    expect(JSON.stringify(codes)).not.toContain('code-1"');
    expect(audit).toEqual([
      expect.objectContaining({
        kind: "support.session_opened",
        actorUserId: "user-a",
        tenantId: "c1",
      }),
    ]);
  });

  it("makes a new code each time and refuses a paused customer", async () => {
    const { deps, codes } = world();
    const a = await openSupportSession(deps, ORG_A, { partnerId: "pa1", tenantId: "c1" });
    const b = await openSupportSession(deps, ORG_A, { partnerId: "pa1", tenantId: "c1" });
    expect(a.url).not.toBe(b.url);
    await expect(
      openSupportSession(deps, ORG_A, { partnerId: "pa1", tenantId: "c4" }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(codes).toHaveLength(2);
  });
});

describe("customers list", () => {
  it("filters by credit low, past due and paused; a paused customer is never credit low", async () => {
    const { deps } = world();
    const names = async (filter: "all" | "credit_low" | "past_due" | "paused") =>
      (await listCustomers(deps, ORG_A, { partnerId: "pa1", filter })).items.map(
        (item) => item.name,
      );
    expect(await names("credit_low")).toEqual(["Beta Salon"]);
    expect(await names("past_due")).toEqual(["Gamma Studio"]);
    expect(await names("paused")).toEqual(["Delta Paused"]);
    expect(await names("all")).toHaveLength(5);
  });

  it("searches by name ignoring case and combines it with a filter", async () => {
    const { deps } = world();
    const result = await listCustomers(deps, ORG_A, { partnerId: "pa1", q: "  SALON " });
    expect(result.items.map((item) => item.name)).toEqual(["Beta Salon"]);
    const none = await listCustomers(deps, ORG_A, {
      partnerId: "pa1",
      q: "salon",
      filter: "paused",
    });
    expect(none.items).toEqual([]);
  });

  it("pages newest first with a cursor that never repeats or skips a customer", async () => {
    const { deps } = world();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listCustomers(deps, ORG_A, { partnerId: "pa1", limit: 2, cursor });
      seen.push(...page.items.map((item) => item.tenantId));
      cursor = page.next ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(pages).toBe(3);
  });

  it("refuses a cursor it did not make", async () => {
    const { deps } = world();
    await expect(
      listCustomers(deps, ORG_A, { partnerId: "pa1", cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(PartnerConsoleError);
  });

  it("shows the item's numbers and states", async () => {
    const { deps } = world();
    const { items } = await listCustomers(deps, ORG_A, { partnerId: "pa1", filter: "credit_low" });
    expect(items).toEqual([
      {
        tenantId: "c2",
        name: "Beta Salon",
        plan: "Team",
        creditUsedPct: 85,
        creditRemaining: 18000,
        state: "active",
        since: "2026-10-20T00:00:00.000Z",
      },
    ]);
  });
});

describe("overview", () => {
  it("counts customers and sums what the partner earned in the month", async () => {
    const { deps } = world();
    const overview = await getOverview(deps, ORG_A, { partnerId: "pa1", period: "2026-11" });
    expect(overview).toMatchObject({
      currency: "BRL",
      // Commission 9980 + 1000, markup 7485 + 700.
      revenue: { commission: 10980, markup: 8185, total: 19165 },
      activeCustomers: 3,
      newCustomers: 1,
      creditLow: 1,
      pastDue: 1,
    });
    expect(overview.monthly).toHaveLength(6);
    expect(overview.monthly.at(-1)).toEqual({ month: "2026-11", total: 19165 });
    expect(overview.monthly.find((entry) => entry.month === "2026-10")?.total).toBe(2000);
    expect(overview.monthly.find((entry) => entry.month === "2026-06")?.total).toBe(0);
  });

  it("lists what needs attention, newest first, without customer content", async () => {
    const { deps } = world();
    const { attention } = await getOverview(deps, ORG_A, { partnerId: "pa1" });
    expect(attention.map((item) => item.kind)).toEqual([
      "credit_low",
      "connector_down",
      "past_due",
      "invoice_issued",
    ]);
    expect(attention.find((item) => item.kind === "credit_low")).toMatchObject({
      tenantId: "c2",
      detail: "85%",
    });
    expect(attention.find((item) => item.kind === "invoice_issued")).toMatchObject({
      detail: "2026-10",
    });
  });

  it("refuses a period that is not a month", async () => {
    const { deps } = world();
    await expect(
      getOverview(deps, ORG_A, { partnerId: "pa1", period: "2026-13" }),
    ).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("revenue and statements", () => {
  it("rolls the ledger up and matches the lines to the totals to the minor unit", async () => {
    const { deps } = world();
    const revenue = await getRevenue(deps, ORG_A, { partnerId: "pa1", period: "2026-11" });
    expect(revenue.lines).toHaveLength(3);
    expect(revenue.totals.partnerMinor).toBe(
      revenue.totals.commissionMinor + revenue.totals.markupMinor,
    );
    expect(revenue.totals.baseMinor).toBe(
      revenue.totals.rookShareMinor + revenue.totals.commissionMinor,
    );
    expect(revenue.invoices).toEqual([
      { id: "inv1", period: "2026-10", state: "issued", totalMinor: 8000 },
    ]);
  });

  it("exports a CSV statement that a spreadsheet cannot run as a formula", async () => {
    const { deps } = world();
    const csv = await getRevenueCsv(deps, ORG_A, { partnerId: "pa1", period: "2026-11" });
    expect(csv.filename).toBe("slug-pa1-2026-11.csv");
    expect(csv.url.startsWith("data:text/csv;charset=utf-8,")).toBe(true);
    const text = decodeURIComponent(csv.url.slice("data:text/csv;charset=utf-8,".length));
    const rows = text.trim().split("\r\n");
    expect(rows[0]).toBe("date,customer,kind,base,rook_share,commission,markup,paid");
    expect(rows[1]).toBe("2026-11-03,Alpha Clinic,subscription,499.00,399.20,99.80,74.85,573.85");
    expect(text).toContain(`"'=HYPERLINK(""x""),""Beta"""`);
  });

  it("formats minor units and escapes cells", () => {
    expect(formatMinor(5)).toBe("0.05");
    expect(formatMinor(-1234)).toBe("-12.34");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("+1")).toBe("'+1");
    expect(statementCsv([])).toBe("date,customer,kind,base,rook_share,commission,markup,paid\r\n");
    expect(lastPeriods("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("integration", () => {
  it("shows the key's start, never the key, and rotates it with an audit event", async () => {
    const { deps, audit } = world();
    const before = await getIntegration(deps, ORG_A, { partnerId: "pa1" });
    expect(before.keys).toEqual([{ prefix: "cpk_pa1", createdAt: "2026-01-01T00:00:00.000Z" }]);
    expect(before.webhook).toEqual({ url: null, enabled: false });
    expect(before.docsUrl).toBe("https://app.example.test/api/partner/v1");
    const rotated = await rotateIntegrationKey(deps, ORG_A, { partnerId: "pa1" });
    expect(rotated).toEqual({ key: "cpk_NEWKEY00.secret", prefix: "cpk_NEWKEY00" });
    expect(audit).toEqual([
      expect.objectContaining({ kind: "key.rotated", detail: { prefix: "cpk_NEWKEY00" } }),
    ]);
    expect(JSON.stringify(audit)).not.toContain("secret");
  });

  it("lists every alert as emailed until switched off, and only for a partner the caller manages", async () => {
    const { deps } = world();
    const before = await getIntegration(deps, ORG_A, { partnerId: "pa1" });
    expect(before.alerts.length).toBeGreaterThan(0);
    expect(before.alerts.every((item) => item.email)).toBe(true);
    await setIntegrationAlertEmail(deps, ORG_A, {
      partnerId: "pa1",
      kind: "partner.balance_low",
      email: false,
    });
    const after = await getIntegration(deps, ORG_A, { partnerId: "pa1" });
    expect(after.alerts.find((item) => item.kind === "partner.balance_low")?.email).toBe(false);
    expect(after.alerts.filter((item) => !item.email)).toHaveLength(1);
    await expect(
      setIntegrationAlertEmail(deps, ORG_A, {
        partnerId: "pb",
        kind: "partner.balance_low",
        email: false,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("sets and clears the webhook, https only", async () => {
    const { deps, audit } = world();
    await expect(
      setIntegrationWebhook(deps, ORG_A, { partnerId: "pa1", url: "http://hook.example.test" }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      await setIntegrationWebhook(deps, ORG_A, {
        partnerId: "pa1",
        url: "https://hook.example.test/in",
      }),
    ).toEqual({ url: "https://hook.example.test/in", enabled: true });
    expect(await setIntegrationWebhook(deps, ORG_A, { partnerId: "pa1", url: null })).toEqual({
      url: null,
      enabled: false,
    });
    expect(audit.map((event) => event.detail)).toEqual([{ enabled: true }, { enabled: false }]);
  });
});

describe("partner template", () => {
  it("reads and replaces the template of the organization's partner, and audits the change", async () => {
    const { deps, audit } = world();
    expect(await getTemplate(deps, ORG_A, { partnerId: "pa1" })).toEqual({ template: null });
    const template = {
      agents: [
        {
          key: "reception",
          name: "Reception",
          instructions: "Greet people.",
          usesConnector: false,
        },
      ],
      chiefName: "Ana",
    };
    expect(await setTemplate(deps, ORG_A, { partnerId: "pa1", template })).toEqual({ template });
    expect(await getTemplate(deps, ORG_A, { partnerId: "pa1" })).toEqual({ template });
    await setTemplate(deps, ORG_A, { partnerId: "pa1", template: null });
    expect(audit.map((event) => [event.kind, event.detail])).toEqual([
      ["template.changed", { agents: 1, removed: false }],
      ["template.changed", { agents: 0, removed: true }],
    ]);
  });
});
