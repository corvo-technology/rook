import type { AdapterContext, ConnectorEvent } from "@corvo/adapter-kit";
import { toolRequiresApproval, toolRequiresExplicitApproval } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import type { PartnerChoice, PartnerToolsPort } from "./partner-connector.js";
import { PARTNER_TOOL_NAMES, PartnerConnector } from "./partner-connector.js";

const ONE: PartnerChoice[] = [{ id: "p1", slug: "clinic", name: "Clinic Suite" }];
const TWO: PartnerChoice[] = [...ONE, { id: "p2", slug: "salon", name: "Salon Suite" }];

function setup(options: { level?: "read" | "write" | null; partners?: PartnerChoice[] } = {}) {
  const level = options.level === undefined ? "read" : options.level;
  const run = vi.fn(async (_call: Parameters<PartnerToolsPort["run"]>[0]) => ({ ok: true }));
  const port: PartnerToolsPort = { partners: async () => options.partners ?? ONE, run };
  const grants = vi.fn(async (_query: unknown) => (level ? { level } : null));
  const connector = new PartnerConnector({
    prisma: { botPartnerGrant: { findFirst: grants } } as never,
    port,
  });
  const context = {
    operationId: "op",
    traceId: "trace",
    spaceId: "space-a",
    userId: "owner-a",
    botId: "bot-a",
    signal: new AbortController().signal,
  } as AdapterContext;
  async function call(tool: string, args: Record<string, unknown>, executionId = "exec-1") {
    const events: ConnectorEvent[] = [];
    for await (const event of connector.execute(
      {
        tool: `partner_${tool}`,
        args,
        executionId,
        route: { connectorId: "partner", toolName: tool },
      },
      context,
    )) {
      events.push(event);
    }
    return events[0]!;
  }
  return { connector, context, run, grants, call };
}

describe("the partner connection's tools", () => {
  it("offers none to an agent without a grant, or to an organization with no partner", async () => {
    expect(await setup({ level: null }).connector.discoverTools(setup().context)).toEqual([]);
    const none = setup({ partners: [] });
    expect(await none.connector.discoverTools(none.context)).toEqual([]);
  });

  it("offers only the five reads at read and all nine tools at write", async () => {
    const reader = setup({ level: "read" });
    const reads = (await reader.connector.discoverTools(reader.context)).map((tool) => tool.name);
    expect(reads).toEqual([
      "partner_list_customers",
      "partner_customer_usage",
      "partner_attention",
      "partner_revenue_summary",
      "partner_invoices",
    ]);
    const writer = setup({ level: "write" });
    const all = await writer.connector.discoverTools(writer.context);
    expect(all.map((tool) => tool.name).sort()).toEqual(
      PARTNER_TOOL_NAMES.map((name) => `partner_${name}`).sort(),
    );
    expect(all.filter((tool) => tool.readOnly === false)).toHaveLength(4);
  });

  it("refuses a write tool at read, even when called by name, and runs nothing", async () => {
    const { call, run } = setup({ level: "read" });
    const event = await call("add_credit", { customer: "c1", amount_minor: 5000 });
    expect(event.type).toBe("error");
    expect(run).not.toHaveBeenCalled();
  });

  it("asks a person for every write, and for no read, whatever the access level", () => {
    for (const name of ["add_credit", "pause_customer", "resume_customer", "set_customer_limit"]) {
      expect(toolRequiresExplicitApproval(`partner_${name}`)).toBe(true);
      expect(toolRequiresApproval(`partner_${name}`, true, false)).toBe(true);
      // A provider claiming a write is a read does not relax it.
      expect(toolRequiresApproval(`partner_${name}`, true, true)).toBe(true);
    }
    for (const name of [
      "list_customers",
      "customer_usage",
      "attention",
      "revenue_summary",
      "invoices",
    ]) {
      expect(toolRequiresExplicitApproval(`partner_${name}`)).toBe(false);
      // Exempt only for a call from the built-in connection.
      expect(toolRequiresApproval(`partner_${name}`, true, true, true)).toBe(false);
    }
  });

  it("asks for the same names from any other source unless it declares them read-only", () => {
    for (const name of ["customer_usage", "attention", "revenue_summary", "invoices"]) {
      expect(toolRequiresApproval(`partner_${name}`, true)).toBe(true);
      expect(toolRequiresApproval(`partner_${name}`, true, true)).toBe(false);
      expect(toolRequiresApproval(`partner_${name}`, true, true, false, true)).toBe(true);
    }
  });

  it("uses the only partner by default, and asks which when there are several", async () => {
    const single = setup();
    expect((await single.call("attention", {})).type).toBe("result");
    expect(single.run).toHaveBeenCalledWith(expect.objectContaining({ partnerId: "p1" }));

    const several = setup({ partners: TWO });
    const asked = await several.call("attention", {});
    expect(asked).toMatchObject({ type: "error" });
    expect((asked as { message: string }).message).toContain("clinic, salon");
    expect(several.run).not.toHaveBeenCalled();

    expect((await several.call("attention", { partner: "SALON" })).type).toBe("result");
    expect(several.run).toHaveBeenCalledWith(expect.objectContaining({ partnerId: "p2" }));
  });

  it("refuses a partner the organization does not manage without running anything", async () => {
    const { call, run } = setup({ partners: TWO });
    const event = await call("invoices", { partner: "someone-elses" });
    expect(event.type).toBe("error");
    expect(run).not.toHaveBeenCalled();
  });

  it("hands a change the call's own key, so a retry of that call acts once", async () => {
    const { call, run } = setup({ level: "write" });
    await call("pause_customer", { customer: "c1" }, "exec-77");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "pause_customer", idempotencyKey: "exec-77" }),
    );
  });

  it("rejects arguments that do not fit before reaching the partner console", async () => {
    const { call, run } = setup({ level: "write" });
    const bad = await call("add_credit", { customer: "c1", amount_minor: -5 });
    expect(bad.type).toBe("error");
    expect(run).not.toHaveBeenCalled();
  });
});
