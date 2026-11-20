import {
  AI_USE_CENTS,
  aiAddOnPriceCents,
  aiLookupKey,
  aiUseGrantCents,
  extraComputerCents,
  extraComputerLookupKey,
  extraPersonCents,
  extraPersonLookupKey,
  planLookupKey,
  planPriceCents,
} from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import { StripeBillingProvider } from "./stripe-billing.js";

interface StoredPrice {
  id: string;
  lookup_key: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string; interval_count: number };
  metadata: Record<string, string>;
  product: { active: boolean };
}

/** A Stripe that keeps prices by lookup key, so a second run finds what the first created. */
function stripe(options: { subscriptions?: unknown[] } = {}) {
  const prices: StoredPrice[] = [];
  const requests: Array<{ method: string; path: string; form: URLSearchParams }> = [];
  const provider = new StripeBillingProvider({
    secretKey: "sk_test_fixture",
    webhookSecret: "whsec_fixture",
    fetch: vi.fn(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const form = new URLSearchParams(String(init?.body ?? ""));
      requests.push({ method, path: url.pathname, form });
      if (url.pathname === "/v1/prices" && method === "GET") {
        const key = url.searchParams.get("lookup_keys[0]");
        return Response.json({
          data: prices.filter((price) => price.lookup_key === key),
          has_more: false,
        });
      }
      if (url.pathname === "/v1/prices" && method === "POST") {
        const price: StoredPrice = {
          id: `price_${prices.length + 1}`,
          lookup_key: form.get("lookup_key") ?? "",
          unit_amount: Number(form.get("unit_amount")),
          currency: form.get("currency") ?? "",
          recurring: { interval: form.get("recurring[interval]") ?? "", interval_count: 1 },
          metadata: Object.fromEntries(
            [...form].flatMap(([name, value]) => {
              const match = /^metadata\[(.+)\]$/.exec(name);
              return match ? [[match[1], value]] : [];
            }),
          ),
          product: { active: true },
        };
        prices.push(price);
        return Response.json(price);
      }
      if (url.pathname === "/v1/subscriptions")
        return Response.json({ data: options.subscriptions ?? [], has_more: false });
      if (url.pathname === "/v1/checkout/sessions" && method === "POST")
        return Response.json({ url: "https://checkout.example.test/plan" });
      return Response.json({ data: [], has_more: false });
    }),
  });
  return { provider, prices, requests };
}

describe("Stripe plan prices by lookup key", () => {
  it("creates every catalog price once, in each currency and interval", async () => {
    const { provider, prices, requests } = stripe();
    const first = await provider.ensurePlanPrices();
    expect(Object.keys(first)).toHaveLength(12 + 4 + 4 + 16);
    expect(prices).toHaveLength(36);

    const team = prices.find((price) => price.lookup_key === planLookupKey("team", "brl", "year"));
    expect(team).toMatchObject({
      unit_amount: planPriceCents("team", "brl", "year"),
      currency: "brl",
      recurring: { interval: "year" },
    });
    const person = prices.find(
      (price) => price.lookup_key === extraPersonLookupKey("usd", "month"),
    );
    expect(person?.unit_amount).toBe(extraPersonCents("usd", "month"));
    const computer = prices.find(
      (price) => price.lookup_key === extraComputerLookupKey("brl", "year"),
    );
    expect(computer).toMatchObject({
      unit_amount: extraComputerCents("brl", "year"),
      currency: "brl",
      recurring: { interval: "year" },
    });

    const writesBefore = requests.filter((r) => r.method === "POST").length;
    expect(await provider.ensurePlanPrices()).toEqual(first);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(writesBefore);
    expect(prices).toHaveLength(36);
  });

  it("marks each AI price with the dollars of use it grants a month", async () => {
    const { provider, prices } = stripe();
    await provider.ensurePlanPrices();
    for (const cents of AI_USE_CENTS) {
      const monthly = prices.find((p) => p.lookup_key === aiLookupKey(cents, "brl", "month"));
      expect(monthly?.unit_amount).toBe(aiAddOnPriceCents("brl", cents, "month"));
      expect(monthly?.metadata.credit_use_cents).toBe(String(cents));
    }
    // A year buys twelve months of use, so the yearly price grants all of it at once.
    const yearly = prices.find((p) => p.lookup_key === aiLookupKey(1000, "usd", "year"));
    expect(yearly?.metadata.credit_use_cents).toBe(String(aiUseGrantCents(1000, "year")));
    expect(aiUseGrantCents(1000, "year")).toBe(12000);
    expect(aiUseGrantCents(1000, "month")).toBe(1000);
    const plan = prices.find((p) => p.lookup_key === planLookupKey("team", "usd", "month"));
    expect(plan?.metadata.credit_use_cents).toBeUndefined();
  });

  it("finds one price id by lookup key, or null when there is none", async () => {
    const { provider } = stripe();
    expect(await provider.priceIdForLookupKey("plan_team_usd_month")).toBeNull();
    await provider.ensurePlanPrices();
    expect(await provider.priceIdForLookupKey("plan_team_usd_month")).toMatch(/^price_/);
  });
});

describe("Stripe plan checkout", () => {
  const urls = { successUrl: "https://app.example/ok", cancelUrl: "https://app.example/no" };
  const base = {
    customerId: "cus_1",
    plan: "team" as const,
    currency: "brl" as const,
    interval: "year" as const,
    ...urls,
  };

  async function lines(input: { extraPeople: number; aiUseCents: 1000 | null }) {
    const { provider, prices, requests } = stripe();
    await provider.createPlanCheckout({ ...base, ...input });
    const session = requests.find((r) => r.path === "/v1/checkout/sessions" && r.method === "POST");
    const form = session!.form;
    const items: Array<{ price: string; quantity: string }> = [];
    for (let i = 0; form.has(`line_items[${i}][price]`); i++)
      items.push({
        price: prices.find((p) => p.id === form.get(`line_items[${i}][price]`))!.lookup_key,
        quantity: form.get(`line_items[${i}][quantity]`)!,
      });
    return { items, form };
  }

  it("sends the plan line alone for an own-AI plan with nobody extra", async () => {
    const { items, form } = await lines({ extraPeople: 0, aiUseCents: null });
    expect(items).toEqual([{ price: "plan_team_brl_year", quantity: "1" }]);
    expect(form.get("mode")).toBe("subscription");
  });

  it("adds an extra-person line with its quantity, and an AI line, only when chosen", async () => {
    const { items } = await lines({ extraPeople: 3, aiUseCents: 1000 });
    expect(items).toEqual([
      { price: "plan_team_brl_year", quantity: "1" },
      { price: "extra_person_brl_year", quantity: "3" },
      { price: "ai_1000_brl_year", quantity: "1" },
    ]);
  });

  it("bills in classic mode and takes the extra-person quantity", async () => {
    const { provider, requests } = stripe();
    await provider.createPlanCheckout({ ...base, extraPeople: 2, aiUseCents: null });
    const session = requests.find((r) => r.path === "/v1/checkout/sessions" && r.method === "POST");
    expect(session?.form.get("line_items[1][quantity]")).toBe("2");
    expect(session?.form.get("subscription_data[billing_mode][type]")).toBe("classic");
  });

  it("requires the terms and records which version was shown", async () => {
    const { provider, requests } = stripe();
    await provider.createPlanCheckout({
      ...base,
      extraPeople: 0,
      aiUseCents: null,
      termsVersion: "2026-01-01",
    });
    const session = requests.find((r) => r.path === "/v1/checkout/sessions" && r.method === "POST");
    expect(session?.form.get("consent_collection[terms_of_service]")).toBe("required");
    expect(session?.form.get("metadata[terms_version]")).toBe("2026-01-01");
  });

  it("refuses to open a second checkout while a subscription is live", async () => {
    const live = {
      id: "sub_1",
      status: "active",
      created: 1,
      items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_x" } }] },
    };
    const { provider } = stripe({ subscriptions: [live] });
    await expect(
      provider.createPlanCheckout({ ...base, extraPeople: 0, aiUseCents: null }),
    ).rejects.toThrow(/already/i);
  });
});

describe("Stripe invoices in another currency", () => {
  const credits = (currency: string, chargeCurrency: string) => {
    const routes = {
      "/v1/charges": {
        data: [
          {
            id: "ch_1",
            payment_intent: "pi_1",
            currency: chargeCurrency,
            paid: true,
            captured: true,
            disputed: false,
            amount: 1000,
            amount_refunded: 0,
          },
        ],
        has_more: false,
      },
      "/v1/invoices": {
        data: [
          {
            id: "in_1",
            currency,
            amount_paid: 1000,
            billing_reason: "subscription_cycle",
            lines: {
              data: [
                {
                  amount: 1000,
                  period: { end: 2_000_000_000 },
                  parent: {
                    type: "subscription_item_details",
                    subscription_item_details: { subscription: "sub_1" },
                  },
                },
              ],
            },
            parent: {
              subscription_details: {
                metadata: { corvo_credit_cents: "1000" },
                subscription: "sub_1",
              },
            },
          },
        ],
        has_more: false,
      },
      "/v1/invoice_payments": {
        data: [{ id: "ip_1", payment: { payment_intent: "pi_1" } }],
        has_more: false,
      },
    } as Record<string, unknown>;
    const provider = new StripeBillingProvider({
      secretKey: "sk_test_fixture",
      webhookSecret: "whsec_fixture",
      fetch: vi.fn(async (input) => {
        const url = new URL(String(input));
        return Response.json(routes[url.pathname] ?? { data: [], has_more: false });
      }),
    });
    return provider.listCreditPurchases("cus_1");
  };

  it("keeps dollar credit packs dollar-only: a reais invoice grants nothing", async () => {
    expect(await credits("usd", "usd")).toMatchObject([{ id: "in_1", amountCents: 1000 }]);
    expect(await credits("brl", "brl")).toEqual([]);
  });

  it("does not count a charge in another currency toward an invoice", async () => {
    expect(await credits("usd", "brl")).toMatchObject([{ id: "in_1", amountCents: 0 }]);
  });
});

describe("Stripe subscription with several lines", () => {
  it("reads the plan line as the base whatever order Stripe lists the lines in", async () => {
    const item = (id: string, lookupKey: string, quantity: number) => ({
      id,
      quantity,
      price: { id: `price_${id}`, lookup_key: lookupKey },
    });
    const { provider } = stripe({
      subscriptions: [
        {
          id: "sub_1",
          status: "active",
          created: 1,
          items: {
            data: [
              item("si_ai", "ai_1000_brl_year", 1),
              item("si_extra", "extra_person_brl_year", 2),
              item("si_plan", "plan_team_brl_year", 1),
            ],
          },
        },
      ],
    });
    expect(await provider.getCustomerSubscription("cus_1")).toMatchObject({
      subscriptionItemId: "si_plan",
      priceId: "price_si_plan",
      priceLookupKey: "plan_team_brl_year",
      seats: 1,
    });
  });
});
