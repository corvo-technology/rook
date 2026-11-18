import { describe, expect, it } from "vitest";
import { StripeBillingProvider } from "./stripe-billing.js";

interface Call {
  method: string;
  path: string;
  body: string;
}

/** A Stripe that holds one active subscription whose items are given, and records writes. */
function stripe(items: Array<{ id: string; price: string; quantity: number; extra?: boolean }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, body: String(init?.body ?? "") });
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
                    metadata: item.extra ? { corvo_extra_seats: "1" } : {},
                    price: { id: item.price },
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

const base = { id: "si_base", price: "price_team", quantity: 1 };

describe("extra seats on a Stripe subscription", () => {
  it("adds the extra seat line, marked as ours, when there is none", async () => {
    const { provider, writes } = stripe([base]);
    await provider.setExtraSeats("cus_1", { priceId: "price_seat", quantity: 2 });
    const [write] = writes();
    expect(write?.path).toBe("/v1/subscription_items");
    const form = new URLSearchParams(write?.body);
    expect(form.get("subscription")).toBe("sub_1");
    expect(form.get("price")).toBe("price_seat");
    expect(form.get("quantity")).toBe("2");
    expect(form.get("metadata[corvo_extra_seats]")).toBe("1");
  });

  it("changes the quantity of an existing extra line, and leaves a matching one alone", async () => {
    const extra = { id: "si_extra", price: "price_seat", quantity: 2, extra: true };
    const changed = stripe([base, extra]);
    await changed.provider.setExtraSeats("cus_1", { priceId: "price_seat", quantity: 3 });
    expect(changed.writes()[0]?.path).toBe("/v1/subscription_items/si_extra");
    expect(new URLSearchParams(changed.writes()[0]?.body).get("quantity")).toBe("3");

    const same = stripe([base, extra]);
    await same.provider.setExtraSeats("cus_1", { priceId: "price_seat", quantity: 2 });
    expect(same.writes()).toEqual([]);
  });

  it("removes the extra line at zero and does nothing when there is none to remove", async () => {
    const extra = { id: "si_extra", price: "price_seat", quantity: 2, extra: true };
    const removed = stripe([base, extra]);
    await removed.provider.setExtraSeats("cus_1", { priceId: "price_seat", quantity: 0 });
    expect(removed.writes()[0]).toMatchObject({ method: "DELETE" });
    expect(removed.writes()[0]?.path).toContain("/v1/subscription_items/si_extra");

    const none = stripe([base]);
    await none.provider.setExtraSeats("cus_1", { priceId: "price_seat", quantity: 0 });
    expect(none.writes()).toEqual([]);
  });
});
