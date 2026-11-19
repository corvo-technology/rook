import { StripeEmulator, StripePaymentsProvider } from "@corvo/adapters";
import { describe, expect, it } from "vitest";
import type { PartnerConnectRecord, PartnerPaymentsStore } from "./payments.js";
import {
  getPartnerPayments,
  openPartnerConnectDashboard,
  startPartnerConnect,
} from "./payments.js";
import type { PartnerConsoleStore, PartnerRecord } from "./types.js";
import { PartnerConsoleError } from "./types.js";

const NOW = Date.UTC(2026, 10, 10);

const record = (id: string, mode: PartnerRecord["mode"]): PartnerRecord => ({
  id,
  slug: id,
  name: `Agency ${id}`,
  mode,
  currency: "BRL",
  billingModel: "commerce",
  commissionBps: 2000,
  checkoutUrl: null,
  keyPrefix: "k",
  webhookUrl: null,
  accent: null,
  chiefName: null,
  template: null,
  createdAt: new Date(NOW),
});

/** Two organizations, each managing its own partner, and an embedded one that is not white label. */
function setup() {
  const partners = {
    "org-a": [record("a", "white_label"), record("emb", "embedded")],
    "org-b": [record("b", "white_label")],
  } as Record<string, PartnerRecord[]>;
  const connects = new Map<string, PartnerConnectRecord>([
    ["a", { accountId: null, state: "none", country: "BR" }],
    ["b", { accountId: "acct_b_secret", state: "active", country: "BR" }],
  ]);
  const payouts = {
    a: [
      {
        id: "po-a",
        amountMinor: 5_000,
        currency: "BRL" as const,
        status: "paid" as const,
        arrivedAt: null,
        createdAt: "2026-11-09T00:00:00.000Z",
      },
    ],
    b: [
      {
        id: "po-b",
        amountMinor: 99_000,
        currency: "BRL" as const,
        status: "paid" as const,
        arrivedAt: null,
        createdAt: "2026-11-09T00:00:00.000Z",
      },
    ],
  } as Record<string, PartnerPaymentsStoreRows>;
  type PartnerPaymentsStoreRows = Awaited<ReturnType<PartnerPaymentsStore["payouts"]>>;
  const audits: string[] = [];
  const store: PartnerPaymentsStore = {
    connect: async (id) => connects.get(id)!,
    saveAccount: async (id, status) => {
      connects.set(id, { ...connects.get(id)!, accountId: status.account, state: status.state });
    },
    saveState: async (id, state) => {
      connects.set(id, { ...connects.get(id)!, state });
    },
    payouts: async (id) => payouts[id] ?? [],
    disputes: async () => [],
    audit: async (event) => {
      audits.push(`${event.partnerId}:${event.kind}`);
    },
  };
  const wire = new StripeEmulator({ now: () => NOW });
  const provider = new StripePaymentsProvider({
    secretKey: wire.secretKey,
    connectWebhookSecret: "whsec_x",
    fetch: wire.fetch,
    now: () => NOW,
  });
  const deps = {
    partners: {
      findPartner: async (organizationId: string, partnerId: string) =>
        partners[organizationId]?.find((partner) => partner.id === partnerId) ?? null,
    } as Pick<PartnerConsoleStore, "findPartner">,
    store,
    provider,
    webOrigin: "https://app.example.test",
  };
  return { deps, wire, connects, audits };
}

const a = { organizationId: "org-a", actorUserId: "u1" };

describe("the receipts of a white label partner", () => {
  it("starts with no account, opens one on connect, and reads the state as onboarding goes", async () => {
    const { deps, wire, connects, audits } = setup();
    const before = await getPartnerPayments(deps, a, { partnerId: "a" });
    expect(before).toMatchObject({ state: "none", accountHint: null, available: true });

    const { url } = await startPartnerConnect(deps, a, { partnerId: "a" });
    expect(url).toContain("connect.stripe.com/setup");
    const account = connects.get("a")!.accountId!;
    expect(connects.get("a")!.state).toBe("pending");
    expect(audits).toEqual(["a:connect.started"]);
    // The same partner asking again opens no second account.
    await startPartnerConnect(deps, a, { partnerId: "a" });
    expect(wire.connect.accounts.size).toBe(1);
    expect((await getPartnerPayments(deps, a, { partnerId: "a" })).state).toBe("pending");
    await expect(openPartnerConnectDashboard(deps, a, { partnerId: "a" })).rejects.toMatchObject({
      code: "conflict",
    });

    // Stripe asks for more: restricted, with what is due.
    wire.connect.activateAccount(account);
    wire.connect.restrictAccount(account, ["individual.id_number"], null);
    const restricted = await getPartnerPayments(deps, a, { partnerId: "a" });
    expect(restricted).toMatchObject({
      state: "restricted",
      requirementsDue: ["individual.id_number"],
    });
    expect(connects.get("a")!.state).toBe("restricted");

    wire.connect.activateAccount(account);
    const active = await getPartnerPayments(deps, a, { partnerId: "a" });
    expect(active.state).toBe("active");
    expect(active.accountHint).toBe(account.slice(-6));
    expect((await openPartnerConnectDashboard(deps, a, { partnerId: "a" })).url).toContain(account);

    wire.connect.restrictAccount(account, [], "rejected.fraud");
    expect((await getPartnerPayments(deps, a, { partnerId: "a" })).state).toBe("disabled");
    await expect(startPartnerConnect(deps, a, { partnerId: "a" })).rejects.toMatchObject({
      code: "refused",
    });
  });

  it("keeps the stored state when the provider cannot be reached", async () => {
    const { deps, connects } = setup();
    connects.set("a", { accountId: "acct_gone", state: "active", country: "BR" });
    expect((await getPartnerPayments(deps, a, { partnerId: "a" })).state).toBe("active");
  });

  it("shows a partner its own payouts and nobody else's", async () => {
    const { deps } = setup();
    const own = await getPartnerPayments(deps, a, { partnerId: "a" });
    expect(own.payouts.map((payout) => payout.id)).toEqual(["po-a"]);
    // Another organization's partner is answered as one that does not exist, for every call.
    for (const call of [getPartnerPayments, startPartnerConnect, openPartnerConnectDashboard]) {
      await expect(call(deps, a, { partnerId: "b" })).rejects.toBeInstanceOf(PartnerConsoleError);
      await expect(call(deps, a, { partnerId: "b" })).rejects.toMatchObject({ code: "not_found" });
    }
    const other = await getPartnerPayments(
      deps,
      { organizationId: "org-b", actorUserId: "u2" },
      { partnerId: "b" },
    );
    expect(other.payouts.map((payout) => payout.id)).toEqual(["po-b"]);
    // The account is never shown whole.
    expect(JSON.stringify(other)).not.toContain("acct_b_secret");
  });

  it("is for white label partners only", async () => {
    const { deps } = setup();
    await expect(getPartnerPayments(deps, a, { partnerId: "emb" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("says so, and starts nothing, where no payment provider is configured", async () => {
    const { deps } = setup();
    const bare = { ...deps, provider: undefined };
    expect((await getPartnerPayments(bare, a, { partnerId: "a" })).available).toBe(false);
    await expect(startPartnerConnect(bare, a, { partnerId: "a" })).rejects.toMatchObject({
      code: "refused",
      reason: "payments_unavailable",
    });
  });
});
