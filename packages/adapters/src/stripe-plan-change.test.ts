import { BillingPaymentRequiredError } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { StripeBillingProvider } from "./stripe-billing.js";

interface Sent {
  method: string;
  path: string;
  form: URLSearchParams;
}

const item = (id: string, lookupKey: string | null, quantity = 1) => ({
  id,
  quantity,
  price: {
    id: lookupKey ? `price_${lookupKey}` : `price_${id}`,
    ...(lookupKey ? { lookup_key: lookupKey } : {}),
  },
});
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  created: 1,
  items: { data: [item("si_plan", "plan_team_usd_month")] },
  ...overrides,
});

/** A Stripe that keeps catalog prices, serves one subscription and one schedule, and logs writes. */
function stripe(
  options: {
    subscription?: Record<string, unknown>;
    schedule?: Record<string, unknown>;
    failUpdate?: { type: string; code?: string };
    priceInfo?: Record<string, { unit_amount: number; metadata?: Record<string, string> }>;
  } = {},
) {
  const prices: Array<Record<string, unknown>> = [];
  const requests: Sent[] = [];
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
        return Response.json({ data: prices.filter((p) => p.lookup_key === key), has_more: false });
      }
      if (url.pathname === "/v1/prices" && method === "POST") {
        const price = {
          id: `price_${form.get("lookup_key")}`,
          lookup_key: form.get("lookup_key"),
          unit_amount: Number(form.get("unit_amount")),
          currency: form.get("currency"),
          recurring: { interval: form.get("recurring[interval]"), interval_count: 1 },
          product: { active: true },
        };
        prices.push(price);
        return Response.json(price);
      }
      const info = options.priceInfo?.[url.pathname.split("/").pop() ?? ""];
      if (url.pathname.startsWith("/v1/prices/") && info) return Response.json(info);
      if (url.pathname === "/v1/subscriptions" && method === "GET")
        return Response.json({ data: [options.subscription ?? subscription()], has_more: false });
      if (/^\/v1\/subscriptions\/sub_1$/.test(url.pathname) && method === "POST") {
        if (options.failUpdate)
          return Response.json(
            { error: { message: "declined", ...options.failUpdate } },
            { status: 402 },
          );
        return Response.json(options.subscription ?? subscription());
      }
      if (url.pathname === "/v1/subscription_schedules" && method === "POST")
        return Response.json({
          id: "sub_sched_1",
          current_phase: { start_date: 100 },
          phases: [
            {
              start_date: 100,
              end_date: 200,
              items: [{ price: "price_plan_team_usd_month", quantity: 1 }],
            },
          ],
        });
      if (url.pathname.startsWith("/v1/subscription_schedules/") && method === "GET")
        return Response.json(options.schedule);
      return Response.json({ data: [], has_more: false });
    }),
  });
  return { provider, requests };
}

const writes = (requests: Sent[]) => requests.filter((r) => r.method === "POST");
const team = {
  plan: "team" as const,
  currency: "usd" as const,
  interval: "month" as const,
  extraPeople: 0,
  aiUseCents: null,
};

describe("Stripe plan change now", () => {
  it("swaps the plan line, adds the AI line and invoices the difference", async () => {
    const { provider, requests } = stripe();
    await provider.changePlan({
      customerId: "cus_1",
      apply: { ...team, plan: "company", aiUseCents: 1000 },
      atRenewal: null,
    });
    const update = writes(requests).find((r) => r.path === "/v1/subscriptions/sub_1")!.form;
    expect(update.get("items[0][id]")).toBe("si_plan");
    expect(update.get("items[0][price]")).toBe("price_plan_company_usd_month");
    expect(update.get("items[1][price]")).toBe("price_ai_1000_usd_month");
    expect(update.get("proration_behavior")).toBe("always_invoice");
    expect(update.get("payment_behavior")).toBe("error_if_incomplete");
    expect(writes(requests).some((r) => r.path.includes("subscription_schedules"))).toBe(false);
  });

  it("moves an own-key subscription onto the plan and clears its marker", async () => {
    const { provider, requests } = stripe({
      subscription: subscription({
        metadata: { corvo_plan: "byok" },
        items: { data: [item("si_byok", null)] },
      }),
    });
    await provider.changePlan({ customerId: "cus_1", apply: team, atRenewal: null });
    const update = writes(requests).find((r) => r.path === "/v1/subscriptions/sub_1")!.form;
    expect(update.get("items[0][id]")).toBe("si_byok");
    expect(update.get("items[0][price]")).toBe("price_plan_team_usd_month");
    expect(update.get("metadata[corvo_plan]")).toBe("");
  });

  it("clears the monthly credit marker with the same request that swaps the price", async () => {
    const { provider, requests } = stripe({
      subscription: subscription({
        metadata: { corvo_credit_cents: "2000" },
        items: { data: [item("si_credit", null)] },
      }),
    });
    await provider.changePlan({ customerId: "cus_1", apply: team, atRenewal: null });
    const updates = writes(requests).filter((r) => r.path === "/v1/subscriptions/sub_1");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.form.get("metadata[corvo_credit_cents]")).toBe("");
  });

  it("removes lines the selection no longer has and resizes the extra people", async () => {
    const { provider, requests } = stripe({
      subscription: subscription({
        items: {
          data: [
            item("si_plan", "plan_team_usd_month"),
            item("si_extra", "extra_person_usd_month", 2),
            item("si_ai", "ai_1000_usd_month"),
          ],
        },
      }),
    });
    await provider.changePlan({
      customerId: "cus_1",
      apply: { ...team, extraPeople: 3 },
      atRenewal: null,
    });
    const update = writes(requests).find((r) => r.path === "/v1/subscriptions/sub_1")!.form;
    expect(update.get("items[0][id]")).toBe("si_extra");
    expect(update.get("items[0][quantity]")).toBe("3");
    expect(update.get("items[1][id]")).toBe("si_ai");
    expect(update.get("items[1][deleted]")).toBe("true");
  });

  it("reports a payment that needs the customer and changes nothing", async () => {
    const { provider } = stripe({ failUpdate: { type: "card_error" } });
    await expect(
      provider.changePlan({
        customerId: "cus_1",
        apply: { ...team, plan: "company" },
        atRenewal: null,
      }),
    ).rejects.toBeInstanceOf(BillingPaymentRequiredError);
  });
});

describe("Stripe plan change at renewal", () => {
  it("leaves the subscription alone and schedules the next period", async () => {
    const { provider, requests } = stripe();
    await provider.changePlan({
      customerId: "cus_1",
      apply: null,
      atRenewal: { ...team, plan: "personal", currency: "usd" },
    });
    expect(writes(requests).some((r) => r.path === "/v1/subscriptions/sub_1")).toBe(false);
    const schedule = writes(requests).find((r) => r.path === "/v1/subscription_schedules")!.form;
    expect(schedule.get("from_subscription")).toBe("sub_1");
    const update = writes(requests).find(
      (r) => r.path === "/v1/subscription_schedules/sub_sched_1",
    )!.form;
    expect(update.get("phases[0][end_date]")).toBe("200");
    expect(update.get("phases[0][items][0][price]")).toBe("price_plan_team_usd_month");
    expect(update.get("phases[1][items][0][price]")).toBe("price_plan_personal_usd_month");
    expect(update.get("phases[1][iterations]")).toBe("1");
    expect(update.get("proration_behavior")).toBe("none");
    expect(update.get("metadata[corvo_pending_plan]")).toBe("plan_personal_usd_month");
  });

  it("releases a waiting change before it replaces it", async () => {
    const { provider, requests } = stripe({
      subscription: subscription({ schedule: "sub_sched_0" }),
    });
    await provider.changePlan({ customerId: "cus_1", apply: null, atRenewal: null });
    expect(writes(requests).map((r) => r.path)).toEqual([
      "/v1/subscription_schedules/sub_sched_0/release",
    ]);
  });

  it("reads a waiting change from the schedule, and none once its phase began", async () => {
    const waiting = {
      id: "sub_sched_1",
      current_phase: { start_date: 100 },
      phases: [
        { start_date: 100, end_date: 200, items: [] },
        { start_date: 200, end_date: 300, items: [] },
      ],
      metadata: { corvo_pending_plan: "plan_personal_usd_month", corvo_pending_ai: "2000" },
    };
    const pending = stripe({
      subscription: subscription({ schedule: "sub_sched_1" }),
      schedule: waiting,
    });
    await expect(pending.provider.getCustomerSubscription("cus_1")).resolves.toMatchObject({
      priceLookupKey: "plan_team_usd_month",
      pendingChange: { priceLookupKey: "plan_personal_usd_month", aiUseCents: 2000 },
    });
    const begun = stripe({
      subscription: subscription({ schedule: "sub_sched_1" }),
      schedule: { ...waiting, current_phase: { start_date: 200 } },
    });
    expect((await begun.provider.getCustomerSubscription("cus_1"))?.pendingChange).toBeUndefined();
  });

  it("releases a schedule before it edits people, so the edit is not refused", async () => {
    const { provider, requests } = stripe({
      subscription: subscription({ schedule: "sub_sched_1" }),
    });
    await provider.setExtraSeats("cus_1", { priceId: "price_extra", quantity: 2 });
    expect(writes(requests)[0]?.path).toBe("/v1/subscription_schedules/sub_sched_1/release");
  });
});

describe("Stripe credit from a plan change invoice", () => {
  const line = (price: string, amount: number, end = 2_000_000_000) => ({
    amount,
    quantity: 1,
    pricing: { price_details: { price } },
    period: { end },
    parent: {
      type: "subscription_item_details",
      subscription_item_details: { subscription: "sub_1" },
    },
  });

  function purchases(lines: unknown[], metadata: Record<string, string> = {}, paid = 600) {
    const routes: Record<string, unknown> = {
      "/v1/charges": {
        data: [
          {
            id: "ch_1",
            payment_intent: "pi_1",
            currency: "usd",
            paid: true,
            captured: true,
            disputed: false,
            amount: paid,
            amount_refunded: 0,
          },
        ],
        has_more: false,
      },
      "/v1/invoices": {
        data: [
          {
            id: "in_change",
            currency: "usd",
            amount_paid: paid,
            billing_reason: "subscription_update",
            lines: { data: lines },
            parent: { subscription_details: { metadata, subscription: "sub_1" } },
          },
        ],
        has_more: false,
      },
      "/v1/invoice_payments": {
        data: [{ id: "ip_1", payment: { payment_intent: "pi_1" } }],
        has_more: false,
      },
    };
    const priceInfo: Record<string, unknown> = {
      price_ai10: {
        unit_amount: 1200,
        lookup_key: "ai_1000_usd_month",
        metadata: { credit_use_cents: "1000" },
      },
      price_ai20: {
        unit_amount: 2400,
        lookup_key: "ai_2000_usd_month",
        metadata: { credit_use_cents: "2000" },
      },
      price_plan: { unit_amount: 3900, lookup_key: "plan_team_usd_month" },
    };
    const provider = new StripeBillingProvider({
      secretKey: "sk_test_fixture",
      webhookSecret: "whsec_fixture",
      fetch: vi.fn(async (input) => {
        const url = new URL(String(input));
        const found = priceInfo[url.pathname.split("/").pop() ?? ""];
        if (url.pathname.startsWith("/v1/prices/") && found) return Response.json(found);
        return Response.json(routes[url.pathname] ?? { data: [], has_more: false });
      }),
    });
    return provider.listCreditPurchases("cus_1");
  }

  it("grants the share of use that a mid-period AI change actually charged", async () => {
    // Half the period left: the old 10 dollar line is credited back, the 20 dollar line charged.
    const result = await purchases([
      line("price_ai10", -600),
      line("price_ai20", 1200),
      line("price_plan", 0),
    ]);
    expect(result).toMatchObject([{ id: "in_change", useCents: 500, amountCents: 500 }]);
  });

  it("grants the share for AI added part-way through a period, not the whole month", async () => {
    const result = await purchases([line("price_ai10", 400), line("price_plan", 1300)], {}, 1700);
    expect(result).toMatchObject([{ useCents: 333 }]);
  });

  it("grants nothing when the change only lowers or keeps the AI line", async () => {
    expect(await purchases([line("price_ai20", -1200), line("price_ai10", 600)])).toEqual([]);
    expect(await purchases([line("price_plan", 1300)])).toEqual([]);
  });

  it("grants nothing from a plan's lines on a subscription that was a credit pack", async () => {
    expect(
      await purchases([line("price_plan", 3900)], { corvo_credit_cents: "2000" }, 3900),
    ).toEqual([]);
  });
});
