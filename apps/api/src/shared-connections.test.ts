import { describe, expect, it, vi } from "vitest";
import {
  actingAsOwnerOf,
  connectionOwners,
  connectionsWhere,
  mcpServersWhere,
} from "./shared-connections.js";

const actor = { userId: "u-b", spaceId: "s-1" };

function db(role: string | null) {
  return {
    spaceMember: { findUnique: async () => (role ? { role, roles: [] } : null) },
    spaceRole: { findMany: async () => [] },
    bot: { findMany: vi.fn(async () => [{ userId: "u-a" }, { userId: "u-b" }]) },
    user: {
      findMany: vi.fn(async () => [
        { id: "u-a", name: "Ana" },
        { id: "u-b", name: "Beto" },
      ]),
    },
  } as never;
}

describe("who sees which connections", () => {
  it("shows a plain member only their own, whatever the list asks for", async () => {
    for (const listing of [true, false]) {
      expect(await connectionsWhere(db("member"), actor, { listing })).toEqual({
        spaceId: "s-1",
        userId: "u-b",
      });
      expect(await mcpServersWhere(db("member"), actor, { listing })).toEqual({
        spaceId: "s-1",
        userId: "u-b",
      });
    }
  });

  it("shows a manager the space's only when the list asks for the space", async () => {
    expect(await connectionsWhere(db("admin"), actor, { listing: false })).toEqual({
      spaceId: "s-1",
      userId: "u-b",
    });
    expect(await mcpServersWhere(db("admin"), actor, { listing: false })).toEqual({
      spaceId: "s-1",
      userId: "u-b",
    });
    const connections = await connectionsWhere(db("admin"), actor, { listing: true });
    expect(connections).toEqual({
      spaceId: "s-1",
      OR: [{ userId: "u-b" }, { userId: { in: ["u-a", "u-b"] } }],
    });
    const servers = await mcpServersWhere(db("owner"), actor, { listing: true });
    expect(servers).toMatchObject({ spaceId: "s-1", OR: [{ userId: "u-b" }, expect.anything()] });
  });

  it("never reaches the connections of someone who owns no agent", async () => {
    // The agent owners are the only other people in the filter: a bystander's connections are
    // personal and are not in it.
    const where = (await connectionsWhere(db("admin"), actor, { listing: true })) as {
      OR: Array<{ userId: unknown }>;
    };
    expect(JSON.stringify(where.OR)).not.toContain("u-c");
  });

  it("names whose a connection is, and marks the actor's own", async () => {
    const owners = await connectionOwners(db("admin"), actor, ["u-a", "u-b", "u-a"]);
    expect(owners.get("u-a")).toEqual({ userId: "u-a", name: "Ana", mine: false });
    expect(owners.get("u-b")).toEqual({ userId: "u-b", name: "Beto", mine: true });
  });

  it("acts as the owner of one row, and refuses a row that is not there", () => {
    const full = { ...actor, email: "", isDeploymentOwner: false };
    expect(actingAsOwnerOf(full, { userId: "u-a" }).userId).toBe("u-a");
    expect(actingAsOwnerOf(full, { userId: "u-b" })).toBe(full);
    expect(() => actingAsOwnerOf(full, null)).toThrow();
  });
});
