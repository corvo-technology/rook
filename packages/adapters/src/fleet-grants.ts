import { can } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { getSpaceMembershipFor, runAsSystem } from "@corvo/db";
import type { FleetGrants } from "./child-bots.js";

const NONE: FleetGrants = {
  manageAgents: false,
  manageRoutines: false,
  manageChannels: false,
  manageConnections: false,
  createAgents: false,
};

/**
 * What the member who started a run may do in its space. The fleet tools act for that person and
 * never beyond them: someone who left the space, or a lookup that fails, gets nothing.
 */
export async function fleetGrantsFor(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<FleetGrants> {
  try {
    const membership = await runAsSystem("read the starter's permissions for the fleet tools", () =>
      getSpaceMembershipFor(prisma, input),
    );
    return {
      manageAgents: can(membership, "manage_agents"),
      manageRoutines: can(membership, "manage_routines"),
      manageChannels: can(membership, "manage_channels"),
      manageConnections: can(membership, "manage_connections"),
      createAgents: can(membership, "create_agents"),
    };
  } catch {
    return NONE;
  }
}
