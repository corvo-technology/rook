import { BillingPaymentRequiredError } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { BillingEmulator } from "./billing-emulator.js";
import { StripeBillingProvider } from "./stripe-billing.js";

interface Call {
  method: string;
  path: string;
  body: string;
}

type Line = { id: string; price: string; quantity: number; lookup?: string; computer?: boolean };

/** A Stripe that holds one active subscription whose items are given, and records writes. */
function stripe(items: Line[], failWith?: { type: string }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, body: String(init?.body ?? "") });
    if (failWith && method !== "GET")
      return new Response(JSON.stringify({ error: { message: "declined", ...failWith } }), {
        status: 402,
      });
    const json =
      url.pathname === "/v1/subscriptions"
        ? {
            has_more: false,
            data: [
              {
                id: "sub_1",
                status: "active",
                created: 1,
                items: {
                  data: items.map((item) => ({
                    id: item.id,
                    quantity: item.quantity,
                    metadata: item.computer ? { corvo_extra_computers: "1" } : {},
                    price: {
                      id: item.price,
                      ...(item.lookup ? { lookup_key: item.lookup } : {}),
                    },
                  })),
                },
              },
            ],
          }
        : { id: "x" };
    return new Response(JSON.stringify(json), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = new StripeBillingProvider({
    secretKey: "sk_test_fake",
    webhookSecret: "whsec_fake",
    fetch: fetchImpl,
  });
  const writes = () => calls.filter((call) => call.method !== "GET");
  return { provider, writes };
}

const base: Line = {
  id: "si_base",
  price: "price_team",
  quantity: 1,
  lookup: "plan_team_usd_month",
};
const extra: Line = {
  id: "si_computer",
  price: "price_computer",
  quantity: 2,
  lookup: "extra_computer_usd_month",
  computer: true,
};

describe("extra computers on a Stripe subscription", () => {
  it("adds the line, marked as ours and charged now, when there is none", async () => {
    const { provider, writes } = stripe([base]);
    await provider.setExtraComputers("cus_1", { priceId: "price_computer", quantity: 2 });
    const [write] = writes();
    expect(write?.path).toBe("/v1/subscription_items");
    const form = new URLSearchParams(write?.body);
    expect(form.get("price")).toBe("price_computer");
    expect(form.get("quantity")).toBe("2");
    expect(form.get("metadata[corvo_extra_computers]")).toBe("1");
    expect(form.get("proration_behavior")).toBe("always_invoice");
    expect(form.get("payment_behavior")).toBe("error_if_incomplete");
  });

  it("changes the quantity, leaves a matching line alone and removes it at zero", async () => {
    const changed = stripe([base, extra]);
    await changed.provider.setExtraComputers("cus_1", { priceId: "price_computer", quantity: 3 });
    expect(changed.writes()[0]?.path).toBe("/v1/subscription_items/si_computer");
    expect(new URLSearchParams(changed.writes()[0]?.body).get("quantity")).toBe("3");

    const same = stripe([base, extra]);
    await same.provider.setExtraComputers("cus_1", { priceId: "price_computer", quantity: 2 });
    expect(same.writes()).toEqual([]);

    const removed = stripe([base, extra]);
    await removed.provider.setExtraComputers("cus_1", { priceId: "price_computer", quantity: 0 });
    expect(removed.writes()[0]).toMatchObject({ method: "DELETE" });

    const none = stripe([base]);
    await none.provider.setExtraComputers("cus_1", { priceId: "price_computer", quantity: 0 });
    expect(none.writes()).toEqual([]);
  });

  it("reports a payment that needs the customer", async () => {
    const { provider } = stripe([base], { type: "card_error" });
    await expect(
      provider.setExtraComputers("cus_1", { priceId: "price_computer", quantity: 1 }),
    ).rejects.toBeInstanceOf(BillingPaymentRequiredError);
  });

  it("reads the quantity into the snapshot and never mistakes the line for the plan", async () => {
    const { provider } = stripe([extra, base]);
    const snapshot = await provider.getCustomerSubscription("cus_1");
    expect(snapshot).toMatchObject({ priceId: "price_team", extraComputers: 2 });
    const bare = stripe([base]);
    expect((await bare.provider.getCustomerSubscription("cus_1"))?.extraComputers).toBeUndefined();
  });
});

describe("extra computers in the billing emulator", () => {
  it("holds the quantity on the subscription and refuses an unpayable increase", async () => {
    const emulator = new BillingEmulator();
    const { customerId } = await emulator.createCustomer({
      email: "a@b.test",
      organizationId: "o",
    });
    await emulator.ensurePlanPrices();
    await emulator.createPlanCheckout({
      customerId,
      plan: "team",
      currency: "usd",
      interval: "month",
      extraPeople: 0,
      aiUseCents: null,
      successUrl: "https://x.invalid/ok",
      cancelUrl: "https://x.invalid/no",
    });
    emulator.completePlanCheckout(customerId);
    await emulator.setExtraComputers(customerId, { priceId: "price_x", quantity: 2 });
    expect((await emulator.getCustomerSubscription(customerId))?.extraComputers).toBe(2);
    emulator.failNextPlanChange = true;
    await expect(
      emulator.setExtraComputers(customerId, { priceId: "price_x", quantity: 3 }),
    ).rejects.toBeInstanceOf(BillingPaymentRequiredError);
    expect((await emulator.getCustomerSubscription(customerId))?.extraComputers).toBe(2);
    await emulator.setExtraComputers(customerId, { priceId: "price_x", quantity: 0 });
    expect((await emulator.getCustomerSubscription(customerId))?.extraComputers).toBeUndefined();
  });
});
