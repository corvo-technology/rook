import type { Actor } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { artifactVisibleWhere } from "./artifacts.js";

const actor: Actor = {
  userId: "u",
  spaceId: "s",
  email: "u@example.test",
  isDeploymentOwner: false,
};

function db(role: string) {
  return {
    spaceMember: { findUnique: async () => ({ role, roles: [] }) },
    spaceRole: {
      findMany: async () => [
        {
          id: "everyone",
          spaceId: "s",
          position: 99,
          keys: ["talk_to_agents"],
          systemKey: "everyone",
        },
      ],
    },
  } as never;
}

describe("artifactVisibleWhere", () => {
  it("adds no empty relation filter for the owner or an admin, who see every agent's files", async () => {
    for (const role of ["owner", "admin"]) {
      const where = await artifactVisibleWhere(db(role), actor);
      expect(JSON.stringify(where)).not.toContain('"bot":{}');
      expect(where.AND).toEqual([]);
    }
  });

  it("keeps a member to the files of agents whose audience includes them", async () => {
    const where = await artifactVisibleWhere(db("member"), actor);
    expect(JSON.stringify(where)).toContain('"audienceRestricted":false');
  });
});
