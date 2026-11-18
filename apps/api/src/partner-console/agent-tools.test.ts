import type { AdapterContext, ConnectorEvent } from "@corvo/adapter-kit";
import { PartnerConnector } from "@corvo/adapters";
import { describe, expect, it } from "vitest";
import { createPartnerToolsPort } from "./agent-tools.js";
import {
  createDeps,
  createFakeStore,
  customerRow,
  partnerRecord,
} from "./fake-store.test-support.js";

const SPACES: Record<string, string> = { "space-a": "org-a", "space-b": "org-b" };

function world() {
  const fake = createFakeStore({
    members: { pa1: ["org-a"], pa2: ["org-a"], pe: ["org-a"], pb: ["org-b"] },
    partners: [
      partnerRecord("pa1"),
      partnerRecord("pa2", { currency: "USD" }),
      partnerRecord("pe", { mode: "embedded", currency: "USD" }),
      partnerRecord("pb"),
    ],
    customers: {
      pa1: [
        customerRow("c1", { name: "Alpha Clinic" }),
        customerRow("c2", { name: "Beta Salon", lowCredit: true, creditUsedPct: 85 }),
        customerRow("c3", { name: "Gamma Studio", state: "past_due" }),
        customerRow("c4", { name: "Delta", connector: "down" }),
      ],
      pe: [customerRow("e1", { name: "Embedded One" })],
      pb: [customerRow("b1", { name: "Other org customer" })],
    },
    invoices: {
      pe: [
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
  const deps = createDeps(fake.store);
  const port = createPartnerToolsPort({
    deps,
    organizationOf: async (spaceId) => SPACES[spaceId] ?? null,
  });
  return { ...fake, port };
}

const run = (
  port: ReturnType<typeof world>["port"],
  spaceId: string,
  partnerId: string,
  tool: Parameters<ReturnType<typeof world>["port"]["run"]>[0]["tool"],
  args: Record<string, unknown> = {},
  idempotencyKey = "key-1",
) => port.run({ spaceId, userId: `owner-${spaceId}`, partnerId, tool, args, idempotencyKey });

describe("partner tools: isolation", () => {
  it("lists only the partners of the space's organization", async () => {
    const { port } = world();
    expect((await port.partners("space-a")).map((partner) => partner.id)).toEqual([
      "pa1",
      "pa2",
      "pe",
    ]);
    expect((await port.partners("space-b")).map((partner) => partner.id)).toEqual(["pb"]);
    expect(await port.partners("space-unknown")).toEqual([]);
  });

  it("never lets one organization read or change the other's partner or customers", async () => {
    const { port, credits, audit, writes } = world();
    for (const tool of ["list_customers", "attention", "revenue_summary", "invoices"] as const) {
      await expect(run(port, "space-b", "pa1", tool)).rejects.toThrow("Not found");
    }
    await expect(run(port, "space-b", "pa1", "customer_usage", { customer: "c1" })).rejects.toThrow(
      "Not found",
    );
    await expect(
      run(port, "space-b", "pa1", "add_credit", { customer: "c1", amount_minor: 5000 }),
    ).rejects.toThrow("Not found");
    await expect(run(port, "space-b", "pa1", "pause_customer", { customer: "c1" })).rejects.toThrow(
      "Not found",
    );
    // A customer of another organization's partner is not found through one's own partner either.
    await expect(run(port, "space-a", "pa1", "customer_usage", { customer: "b1" })).rejects.toThrow(
      "Not found",
    );
    expect(credits).toEqual([]);
    expect(audit).toEqual([]);
    expect(writes.state).toBe(0);
  });

  it("answers a space with no organization as not found", async () => {
    const { port } = world();
    await expect(run(port, "space-unknown", "pa1", "attention")).rejects.toThrow("Not found");
  });
});

describe("partner tools: reads", () => {
  it("lists customers by filter and name, with numbers and states only", async () => {
    const { port } = world();
    const low = (await run(port, "space-a", "pa1", "list_customers", { filter: "credit_low" })) as {
      customers: Array<{ id: string; name: string }>;
    };
    expect(low.customers.map((customer) => customer.id)).toEqual(["c2"]);
    const named = (await run(port, "space-a", "pa1", "list_customers", {
      filter: "all",
      q: "gamma",
    })) as { customers: Array<{ id: string; state: string }> };
    expect(named.customers).toEqual([expect.objectContaining({ id: "c3", state: "past_due" })]);
  });

  it("shows one customer's usage by id or by exact name, and no agent or conversation content", async () => {
    const { port } = world();
    const byId = await run(port, "space-a", "pa1", "customer_usage", { customer: "c1" });
    const byName = await run(port, "space-a", "pa1", "customer_usage", {
      customer: "alpha clinic",
    });
    expect(byName).toEqual(byId);
    expect(byId).toMatchObject({ plan: "Team", state: "active", runs_30d: 12 });
    // The fake store's detail carries an agent name; the tools never pass it on.
    expect(JSON.stringify(byId)).not.toContain("Chief");
  });

  it("includes credits used and the limit for an embedded partner", async () => {
    const { port } = world();
    const usage = await run(port, "space-a", "pe", "customer_usage", { customer: "e1" });
    expect(usage).toMatchObject({ credits_used: 120, credit_limit: null });
  });

  it("collects who needs attention, including a near limit and a fund running out", async () => {
    const { port } = world();
    const plain = (await run(port, "space-a", "pa1", "attention")) as {
      attention: Array<{ kind: string }>;
    };
    expect(plain.attention.map((entry) => entry.kind).sort()).toEqual([
      "connector_down",
      "credit_low",
      "past_due",
    ]);
    // 120 credits used so far this month by one customer against a 5000 fund is far from empty.
    const embedded = (await run(port, "space-a", "pe", "attention")) as {
      attention: Array<{ kind: string }>;
    };
    expect(embedded.attention.some((entry) => entry.kind === "fund_running_out")).toBe(false);
  });

  it("answers revenue as commission for referral partners and as fund and invoices for embedded ones", async () => {
    const { port } = world();
    const referral = (await run(port, "space-a", "pa1", "revenue_summary")) as Record<
      string,
      unknown
    >;
    expect(referral).toHaveProperty("revenue");
    expect(referral).not.toHaveProperty("fund");
    const embedded = (await run(port, "space-a", "pe", "revenue_summary")) as Record<
      string,
      unknown
    >;
    expect(embedded).toMatchObject({
      mode: "embedded",
      fund: { plan_credits: 0, topup_credits: 5000 },
      invoices: [expect.objectContaining({ id: "inv1" })],
    });
    expect(embedded).not.toHaveProperty("revenue");
    expect(await run(port, "space-a", "pe", "invoices")).toMatchObject({ currency: "USD" });
  });
});

describe("partner tools: changes", () => {
  it("adds credit once for one call, however often it is retried, and audits it", async () => {
    const { port, credits, audit } = world();
    const args = { customer: "c1", amount_minor: 5000 };
    await run(port, "space-a", "pa1", "add_credit", args, "exec-9");
    const again = await run(port, "space-a", "pa1", "add_credit", args, "exec-9");
    expect(again).toMatchObject({ already_done: true });
    expect(credits).toEqual([{ tenantId: "c1", amountMinor: 5000, key: "exec-9" }]);
    expect(audit.filter((event) => event.kind === "customer.credit_added")).toEqual([
      expect.objectContaining({ partnerId: "pa1", tenantId: "c1", actorUserId: "owner-space-a" }),
    ]);
  });

  it("pauses, resumes and caps a customer, each audited", async () => {
    const { port, audit } = world();
    await run(port, "space-a", "pa1", "pause_customer", { customer: "c1" }, "k1");
    expect(
      await run(port, "space-a", "pa1", "resume_customer", { customer: "c1" }, "k2"),
    ).toMatchObject({ state: "active" });
    expect(
      await run(port, "space-a", "pe", "set_customer_limit", {
        customer: "e1",
        limit_credits: 900,
      }),
    ).toMatchObject({ credit_limit: 900 });
    expect(audit.map((event) => event.kind)).toEqual([
      "customer.paused",
      "customer.resumed",
      "credit.limit_changed",
    ]);
  });

  it("refuses to guess between two customers with the same name", async () => {
    const fake = createFakeStore({
      members: { p: ["org-a"] },
      partners: [partnerRecord("p")],
      customers: {
        p: [customerRow("x1", { name: "Twin" }), customerRow("x2", { name: "Twin" })],
      },
    });
    const port = createPartnerToolsPort({
      deps: createDeps(fake.store),
      organizationOf: async () => "org-a",
    });
    await expect(run(port, "space-a", "p", "pause_customer", { customer: "twin" })).rejects.toThrow(
      "More than one customer",
    );
    expect(fake.writes.state).toBe(0);
  });
});

describe("partner tools through the connection", () => {
  function connector(
    world_: ReturnType<typeof world>,
    spaceId: string,
    level: "read" | "write" | null,
  ) {
    const connection = new PartnerConnector({
      prisma: { botPartnerGrant: { findFirst: async () => (level ? { level } : null) } } as never,
      port: world_.port,
    });
    const context = {
      operationId: "op",
      traceId: "trace",
      spaceId,
      userId: `owner-${spaceId}`,
      botId: "bot",
      signal: new AbortController().signal,
    } as AdapterContext;
    const call = async (tool: string, args: Record<string, unknown>) => {
      const events: ConnectorEvent[] = [];
      for await (const event of connection.execute(
        {
          tool: `partner_${tool}`,
          args,
          executionId: "exec",
          route: { connectorId: "partner", toolName: tool },
        },
        context,
      )) {
        events.push(event);
      }
      return events[0]!;
    };
    return { connection, context, call };
  }

  it("asks which partner when the organization has several, then works with the one named", async () => {
    const { call } = connector(world(), "space-a", "read");
    const asked = await call("list_customers", {});
    expect(asked).toMatchObject({ type: "error" });
    expect((asked as { message: string }).message).toContain("slug-pa1");
    const named = await call("list_customers", { partner: "slug-pa1" });
    expect(named.type).toBe("result");
  });

  it("defaults to the only partner of the other organization and cannot name this one's", async () => {
    const { call } = connector(world(), "space-b", "read");
    const own = (await call("list_customers", {})) as { data: { customers: unknown[] } };
    expect(own.data.customers).toHaveLength(1);
    expect((await call("list_customers", { partner: "slug-pa1" })).type).toBe("error");
  });

  it("offers an organization with no partner nothing", async () => {
    const w = world();
    SPACES["space-none"] = "org-none";
    const { connection, context } = connector(w, "space-none", "write");
    expect(await connection.discoverTools(context)).toEqual([]);
    delete SPACES["space-none"];
  });

  it("returns no conversation content from any read tool", async () => {
    const { call } = connector(world(), "space-a", "read");
    const text = JSON.stringify([
      await call("list_customers", { partner: "slug-pa1" }),
      await call("customer_usage", { partner: "slug-pa1", customer: "c1" }),
      await call("attention", { partner: "slug-pa1" }),
      await call("revenue_summary", { partner: "slug-pa1" }),
      await call("invoices", { partner: "slug-pa1" }),
    ]);
    for (const forbidden of ["message", "transcript", "conversation", "Chief", "prompt"]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
