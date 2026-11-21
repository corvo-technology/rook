import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { grantCreatorServersByRole } from "./connector-role-grants.js";

const tools = [
  { name: "list_appointments", description: "List the agenda", readOnly: true },
  { name: "create_appointment", description: "Book an appointment" },
  { name: "list_cash_entries", description: "Cash and financial entries", readOnly: true },
  { name: "refund_payment", description: "Refund a payment" },
];
const lead = { botId: "lead", spaceId: "space", userId: "user" };

function setup(leadGrant: Record<string, unknown> | null, listed = tools) {
  const upsert = vi.fn(async (_args: unknown) => ({}));
  const prisma = {
    botMcpServer: {
      findMany: vi.fn(async () => (leadGrant ? [{ serverId: "srv" }] : [])),
      findFirst: vi.fn(async () => leadGrant),
      upsert,
    },
  } as unknown as PrismaClient;
  const mcpServerTools = vi.fn(async () => listed);
  return { deps: { prisma, mcpServerTools }, upsert };
}
const full = { allowAllTools: true, allowedTools: [], level: "write" };

describe("grantCreatorServersByRole", () => {
  it("lends a new reception agent only its role's tools", async () => {
    const { deps, upsert } = setup(full);
    await grantCreatorServersByRole(deps, lead, { id: "lia", name: "Lia", title: "Recepção" });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { botId_serverId: { botId: "lia", serverId: "srv" } },
      create: {
        allowAllTools: false,
        allowedTools: ["list_appointments", "create_appointment"],
        level: "write",
      },
      update: {},
    });
  });

  it("never lends a money-moving tool to finance", async () => {
    const { deps, upsert } = setup(full);
    await grantCreatorServersByRole(deps, lead, { id: "c", name: "Caio", title: "Financeiro" });
    const [[args]] = upsert.mock.calls as unknown as [[{ create: { allowedTools: string[] } }]];
    const { create } = args;
    expect(create.allowedTools).toEqual(["list_cash_entries"]);
  });

  it("falls back to read-only for an unknown role", async () => {
    const { deps, upsert } = setup(full);
    await grantCreatorServersByRole(deps, lead, { id: "z", name: "Zed", title: "Gardener" });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { allowAllTools: true, allowedTools: [], level: "read" },
    });
  });

  it("falls back to read-only when the tools cannot be listed", async () => {
    const { deps, upsert } = setup(full, []);
    await grantCreatorServersByRole(deps, lead, { id: "lia", name: "Lia", title: "Recepção" });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ create: { level: "read" } });
  });

  it("never goes past what the creator may use", async () => {
    const { deps, upsert } = setup({
      allowAllTools: false,
      allowedTools: ["list_appointments"],
      level: "write",
    });
    await grantCreatorServersByRole(deps, lead, { id: "lia", name: "Lia", title: "Recepção" });
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { allowedTools: ["list_appointments"] },
    });
  });

  it("lends nothing when the creator has no server", async () => {
    const { deps, upsert } = setup(null);
    await grantCreatorServersByRole(deps, lead, { id: "lia", name: "Lia", title: "Recepção" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
