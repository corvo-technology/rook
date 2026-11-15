import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { FleetGrants } from "./child-bots.js";
import { managedBotsWhere, managedGroupsWhere, managedRoutinesWhere } from "./child-bots.js";
import { fleetGrantsFor } from "./fleet-grants.js";
import { listRoutines } from "./fleet-routines.js";
import type { FleetRun } from "./fleet-tools.js";
import { createChildRoutine, prepareFleetRequest } from "./fleet-tools.js";

const none: FleetGrants = {
  manageAgents: false,
  manageRoutines: false,
  manageChannels: false,
  manageConnections: false,
  createAgents: false,
};

/** The agent belongs to the owner; the person asking is a different member. */
function runWith(grants: FleetGrants): FleetRun {
  return {
    spaceId: "space-1",
    userId: "owner",
    requestedByUserId: "member",
    grants,
    botId: "chief",
    groupId: null,
    threadId: "t1",
    runId: "run-1",
  };
}

describe("what the fleet tools reach is what the person asking may reach", () => {
  it("is the space's agents with manage_agents and only their own without it", () => {
    expect(managedBotsWhere(runWith({ ...none, manageAgents: true }))).toEqual({
      spaceId: "space-1",
    });
    // The agent owner's authority is never lent to the member talking to it.
    expect(managedBotsWhere(runWith(none))).toEqual({ userId: "member", spaceId: "space-1" });
  });

  it("is the space's routines with manage_routines and only their own without it", () => {
    expect(managedRoutinesWhere(runWith({ ...none, manageRoutines: true }))).toEqual({
      spaceId: "space-1",
      bot: { spaceId: "space-1", userId: "member", archivedAt: null },
    });
    expect(
      managedRoutinesWhere(runWith({ ...none, manageRoutines: true, manageAgents: true })),
    ).toEqual({
      spaceId: "space-1",
      bot: { spaceId: "space-1", archivedAt: null },
    });
    expect(managedRoutinesWhere(runWith(none))).toMatchObject({ userId: "member" });
  });

  it("is the space's channels with manage_channels and only their own without it", () => {
    expect(managedGroupsWhere(runWith({ ...none, manageChannels: true }))).toEqual({
      spaceId: "space-1",
    });
    expect(managedGroupsWhere(runWith(none))).toEqual({ spaceId: "space-1", userId: "member" });
  });

  it("acts for the owner as before when the owner started the run", () => {
    const run: FleetRun = {
      spaceId: "space-1",
      userId: "owner",
      botId: "c",
      groupId: null,
      threadId: "t",
      runId: "r",
    };
    expect(managedBotsWhere(run)).toEqual({ userId: "owner", spaceId: "space-1" });
  });

  it("lists routines under the routine scope", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      routine: { findMany },
      run: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    await listRoutines({ prisma }, runWith({ ...none, manageRoutines: true, manageAgents: true }));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: "space-1", bot: { spaceId: "space-1", archivedAt: null } },
      }),
    );
    findMany.mockClear();
    await listRoutines({ prisma }, runWith(none));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "member" }) }),
    );
  });

  it("refuses to create a routine for someone without manage_routines", async () => {
    const prisma = {} as unknown as PrismaClient;
    const prepared = await prepareFleetRequest(
      { prisma, modelChange: {} as never },
      runWith(none),
      "create_child_routine",
      { bot_id: "b", name: "n", prompt: "p", cron: "0 9 * * *" },
    );
    expect(prepared).toMatchObject({ ok: false });
    expect(
      await createChildRoutine({ prisma } as never, runWith(none), {
        name: "n",
        prompt: "p",
        schedule: {},
      }),
    ).toMatchObject({ error: expect.stringContaining("cannot create routines") });
  });
});

describe("fleetGrantsFor", () => {
  it("fails closed when the person left the space or the lookup fails", async () => {
    const gone = {
      spaceMember: { findUnique: vi.fn(async () => null) },
      spaceRole: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    expect(await fleetGrantsFor(gone, { spaceId: "s", userId: "u" })).toEqual(none);
    const broken = {} as unknown as PrismaClient;
    expect(await fleetGrantsFor(broken, { spaceId: "s", userId: "u" })).toEqual(none);
  });

  it("reads the keys of an admin and of a plain member", async () => {
    const db = (role: string) =>
      ({
        spaceMember: { findUnique: vi.fn(async () => ({ role, roles: [] })) },
        spaceRole: { findMany: vi.fn(async () => []) },
      }) as unknown as PrismaClient;
    expect(await fleetGrantsFor(db("owner"), { spaceId: "s", userId: "u" })).toEqual({
      manageAgents: true,
      manageRoutines: true,
      manageChannels: true,
      manageConnections: true,
      createAgents: true,
    });
    const member = await fleetGrantsFor(db("member"), { spaceId: "s", userId: "u" });
    expect(member).toMatchObject({ manageAgents: false, manageRoutines: false });
  });
});
