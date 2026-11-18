import { describe, expect, it } from "vitest";
import {
  createDeps,
  createFakeStore,
  customerRow,
  partnerRecord,
} from "./fake-store.test-support.js";
import {
  getCredits,
  getPricing,
  listInvoices,
  setAllowedModels,
  setAutoTopup,
  setCustomerCreditLimit,
  setPricing,
  startTopup,
} from "./service.js";

const ORG_A = { organizationId: "org-a", actorUserId: "user-a" };
const ORG_B = { organizationId: "org-b", actorUserId: "user-b" };

function world() {
  const fake = createFakeStore({
    members: { emb: ["org-a"], ref: ["org-a"], other: ["org-b"] },
    partners: [
      partnerRecord("emb", { mode: "embedded", currency: "USD" }),
      partnerRecord("ref", { mode: "white_label" }),
      partnerRecord("other", { mode: "embedded" }),
    ],
    customers: {
      emb: [customerRow("c1"), customerRow("c2")],
      other: [customerRow("o1")],
    },
    invoices: {
      emb: [{ id: "i1", period: "2026-10", state: "paid", totalMinor: 9900, issuedAt: null }],
    },
  });
  return { ...fake, deps: createDeps(fake.store) };
}

describe("embedded credit model", () => {
  it("shows the fund and each customer's use, in credits", async () => {
    const { deps } = world();
    const credits = await getCredits(deps, ORG_A, { partnerId: "emb" });
    expect(credits.currency).toBe("USD");
    expect(credits.balance).toEqual({ planCredits: 0, topupCredits: 5000 });
    expect(credits.customers).toHaveLength(2);
    expect(credits.customers[0]).toMatchObject({ usedCredits: 120, limitCredits: null });
  });

  it("keeps markup and commission for referral partners only", async () => {
    const { deps } = world();
    await expect(getPricing(deps, ORG_A, { partnerId: "emb" })).rejects.toMatchObject({
      code: "refused",
      reason: "credits_model",
    });
    await expect(setPricing(deps, ORG_A, { partnerId: "emb", markups: [] })).rejects.toMatchObject({
      code: "refused",
    });
    await expect(getCredits(deps, ORG_A, { partnerId: "ref" })).rejects.toMatchObject({
      code: "refused",
      reason: "referral_model",
    });
    expect((await getPricing(deps, ORG_A, { partnerId: "ref" })).plans.length).toBeGreaterThan(0);
  });

  it("sets and removes a per-customer limit, audited", async () => {
    const { deps, audit } = world();
    await setCustomerCreditLimit(deps, ORG_A, {
      partnerId: "emb",
      tenantId: "c1",
      limitCredits: 500,
    });
    expect((await getCredits(deps, ORG_A, { partnerId: "emb" })).customers[0]?.limitCredits).toBe(
      500,
    );
    await setCustomerCreditLimit(deps, ORG_A, {
      partnerId: "emb",
      tenantId: "c1",
      limitCredits: null,
    });
    expect(
      (await getCredits(deps, ORG_A, { partnerId: "emb" })).customers[0]?.limitCredits,
    ).toBeNull();
    expect(audit.map((event) => event.kind)).toEqual([
      "credit.limit_changed",
      "credit.limit_changed",
    ]);
    await expect(
      setCustomerCreditLimit(deps, ORG_A, { partnerId: "emb", tenantId: "c1", limitCredits: 0 }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("limits only the Rook-provided models, dedupes and sorts the list", async () => {
    const { deps } = world();
    expect(
      await setAllowedModels(deps, ORG_A, { partnerId: "emb", models: ["b", " a ", "b", ""] }),
    ).toEqual({ models: ["a", "b"] });
    expect((await getCredits(deps, ORG_A, { partnerId: "emb" })).allowedModels).toEqual(["a", "b"]);
  });

  it("needs a threshold and an amount to turn auto top-up on", async () => {
    const { deps } = world();
    await expect(
      setAutoTopup(deps, ORG_A, {
        partnerId: "emb",
        enabled: true,
        thresholdCredits: 100,
        amountMinor: null,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await setAutoTopup(deps, ORG_A, {
      partnerId: "emb",
      enabled: true,
      thresholdCredits: 100,
      amountMinor: 5000,
    });
    expect((await getCredits(deps, ORG_A, { partnerId: "emb" })).autoTopup).toEqual({
      enabled: true,
      thresholdCredits: 100,
      amountMinor: 5000,
    });
  });

  it("starts a top-up through checkout, and refuses where nothing bills", async () => {
    const { deps, audit } = world();
    await expect(
      startTopup(deps, ORG_A, { partnerId: "emb", amountMinor: 5000 }),
    ).rejects.toMatchObject({ reason: "billing_unavailable" });
    const billed = {
      ...deps,
      topupCheckout: async () => ({ url: "https://pay.example.test/c/1" }),
    };
    expect(await startTopup(billed, ORG_A, { partnerId: "emb", amountMinor: 5000 })).toEqual({
      url: "https://pay.example.test/c/1",
    });
    expect(audit.at(-1)).toMatchObject({
      kind: "credit.topup_started",
      detail: { amountMinor: 5000, currency: "USD" },
    });
  });

  it("lists what the partner paid Rook", async () => {
    const { deps } = world();
    expect(await listInvoices(deps, ORG_A, { partnerId: "emb" })).toEqual([
      { id: "i1", period: "2026-10", state: "paid", totalMinor: 9900 },
    ]);
  });

  it("keeps every credit control inside the organization's own partners", async () => {
    const { deps, audit } = world();
    const tries = [
      () => getCredits(deps, ORG_A, { partnerId: "other" }),
      () =>
        setCustomerCreditLimit(deps, ORG_A, {
          partnerId: "other",
          tenantId: "o1",
          limitCredits: 1,
        }),
      () => setAllowedModels(deps, ORG_A, { partnerId: "other", models: ["a"] }),
      () =>
        setAutoTopup(deps, ORG_A, {
          partnerId: "other",
          enabled: false,
          thresholdCredits: null,
          amountMinor: null,
        }),
      () => startTopup(deps, ORG_A, { partnerId: "other", amountMinor: 100 }),
      () => listInvoices(deps, ORG_A, { partnerId: "other" }),
      // And a customer of another partner, through this organization's own partner.
      () =>
        setCustomerCreditLimit(deps, ORG_A, { partnerId: "emb", tenantId: "o1", limitCredits: 1 }),
    ];
    for (const attempt of tries)
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    expect(audit).toEqual([]);
    expect((await getCredits(deps, ORG_B, { partnerId: "other" })).customers).toHaveLength(1);
  });
});
