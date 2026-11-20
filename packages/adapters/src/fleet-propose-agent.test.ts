import type { PrismaClient } from "@corvo/db";
import { describe, expect, it } from "vitest";
import type { FleetPrepareDeps, FleetRun } from "./fleet-tools.js";
import { prepareFleetRequest, reverifyProposedAgentGrants } from "./fleet-tools.js";

type Row = { id: string; name: string; slug?: string; address?: string; userId?: string };

function fakePrisma(rows: { mcp?: Row[]; mailbox?: Row[]; database?: Row[] }) {
  const finder = (list: Row[] = []) => ({
    findMany: async ({ where }: { where: { id?: string; userId?: string } }) =>
      list.filter(
        (row) =>
          (where.id === undefined || row.id === where.id) &&
          (where.userId === undefined || row.userId === where.userId),
      ),
  });
  return {
    mcpServer: finder(rows.mcp),
    mailbox: finder(rows.mailbox),
    databaseConnection: finder(rows.database),
  } as unknown as PrismaClient;
}

const grants = {
  manageAgents: false,
  manageRoutines: false,
  manageChannels: false,
  manageConnections: false,
  createAgents: true,
};
const run: FleetRun = {
  spaceId: "space-1",
  userId: "owner",
  botId: "chief",
  groupId: null,
  threadId: "thread",
  runId: "run",
  grants,
};
const gmail: Row = { id: "mb-1", name: "Gmail", address: "me@example.com", userId: "owner" };

const prepare = (prisma: PrismaClient, args: Record<string, unknown>, asRun: FleetRun = run) =>
  prepareFleetRequest({ prisma } as unknown as FleetPrepareDeps, asRun, "propose_agent", args);

const base = {
  name: "Email assistant",
  prompt: "Sort my inbox",
  connections: [{ kind: "mailbox", connection: "gmail", level: "write" }],
};

describe("propose_agent", () => {
  it("shows the name, the access and the first task, and stores the resolved ids", async () => {
    const prepared = await prepare(fakePrisma({ mailbox: [gmail] }), base);
    expect(prepared).toMatchObject({
      ok: true,
      canonical: {
        grants: [{ kind: "mailbox", connectionId: "mb-1", level: "write", label: "Gmail" }],
      },
      summary: {
        code: "create_agent",
        params: { name: "Email assistant", write: "Gmail", task: "Sort my inbox" },
        title: "Create agent “Email assistant”?",
        lines: ["Can read and write: Gmail", "First task: Sort my inbox"],
      },
    });
  });

  it("refuses a connection that is not in the space or not the owner's", async () => {
    const other = { ...gmail, userId: "someone-else" };
    const prepared = await prepare(fakePrisma({ mailbox: [other] }), base);
    expect(prepared).toMatchObject({ ok: false, error: expect.stringContaining("No mailbox") });
    expect(await prepare(fakePrisma({}), base)).toMatchObject({ ok: false });
  });

  it("refuses write on a database", async () => {
    const prepared = await prepare(
      fakePrisma({ database: [{ id: "db-1", name: "Sales" }] }),
      { name: "A", connections: [{ kind: "database", connection: "Sales", level: "write" }] },
      { ...run, grants: { ...grants, manageConnections: true } },
    );
    expect(prepared).toMatchObject({ ok: false, error: expect.stringContaining("only read") });
  });

  it("refuses a database for someone who cannot manage connections", async () => {
    const prepared = await prepare(fakePrisma({ database: [{ id: "db-1", name: "Sales" }] }), {
      name: "A",
      connections: [{ kind: "database", connection: "Sales", level: "read" }],
    });
    expect(prepared).toMatchObject({ ok: false, error: expect.stringContaining("cannot lend") });
  });

  it("refuses when the member who asked is not the owner who would lend", async () => {
    const prepared = await prepare(fakePrisma({ mailbox: [gmail] }), base, {
      ...run,
      requestedByUserId: "teammate",
    });
    expect(prepared).toMatchObject({ ok: false, error: expect.stringContaining("cannot lend") });
  });

  it("refuses someone who cannot create agents", async () => {
    const prepared = await prepare(fakePrisma({ mailbox: [gmail] }), base, {
      ...run,
      grants: { ...grants, createAgents: false },
    });
    expect(prepared).toMatchObject({ ok: false, error: expect.stringContaining("create agents") });
  });

  it("refuses an ambiguous name and a repeated connection", async () => {
    const twin = { ...gmail, id: "mb-2" };
    expect(await prepare(fakePrisma({ mailbox: [gmail, twin] }), base)).toMatchObject({
      ok: false,
      error: expect.stringContaining("More than one"),
    });
    const twice = { ...base, connections: [...base.connections, ...base.connections] };
    expect(await prepare(fakePrisma({ mailbox: [gmail] }), twice)).toMatchObject({ ok: false });
  });

  it("refuses credentials and long instructions the card could not show", async () => {
    const db = fakePrisma({ mailbox: [gmail] });
    expect(await prepare(db, { ...base, instructions: "x".repeat(1_001) })).toMatchObject({
      ok: false,
    });
    expect(await prepare(db, { ...base, prompt: "a‮b" })).toMatchObject({ ok: false });
  });
});

describe("approved propose_agent", () => {
  const approved = {
    name: "Email assistant",
    grants: [{ kind: "mailbox", connectionId: "mb-1", level: "read", label: "Gmail" }],
  };

  it("lends exactly the approved ids and levels", async () => {
    const result = await reverifyProposedAgentGrants(
      fakePrisma({ mailbox: [gmail] }),
      run,
      approved,
    );
    expect(result).toEqual({
      ok: true,
      grants: [{ kind: "mailbox", connectionId: "mb-1", level: "read" }],
    });
  });

  it("never widens to another connection of the same name added while the card waited", async () => {
    const twin = { ...gmail, id: "mb-2" };
    const result = await reverifyProposedAgentGrants(
      fakePrisma({ mailbox: [gmail, twin] }),
      run,
      approved,
    );
    expect(result).toEqual({
      ok: true,
      grants: [{ kind: "mailbox", connectionId: "mb-1", level: "read" }],
    });
  });

  it("refuses when the connection was revoked or renamed while the card waited", async () => {
    expect(await reverifyProposedAgentGrants(fakePrisma({}), run, approved)).toMatchObject({
      ok: false,
    });
    const renamed = { ...gmail, name: "Work mail" };
    expect(
      await reverifyProposedAgentGrants(fakePrisma({ mailbox: [renamed] }), run, approved),
    ).toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    const taken = { ...gmail, userId: "someone-else" };
    expect(
      await reverifyProposedAgentGrants(fakePrisma({ mailbox: [taken] }), run, approved),
    ).toMatchObject({ ok: false });
  });

  it("refuses an approved request with no access, or when the asker lost the right to create", async () => {
    expect(
      await reverifyProposedAgentGrants(fakePrisma({ mailbox: [gmail] }), run, { name: "A" }),
    ).toMatchObject({ ok: false });
    expect(
      await reverifyProposedAgentGrants(
        fakePrisma({ mailbox: [gmail] }),
        { ...run, grants: { ...grants, createAgents: false } },
        approved,
      ),
    ).toMatchObject({ ok: false });
  });
});
