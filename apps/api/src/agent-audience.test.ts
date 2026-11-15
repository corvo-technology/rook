import { describe, expect, it, vi } from "vitest";
import {
  audiencesOf,
  requireCanTalkTo,
  requireInAudience,
  talkableBotIds,
} from "./agent-audience.js";

type Row = {
  id: string;
  userId: string;
  audienceRestricted: boolean;
  audienceRoleIds: string[];
  audienceUserIds: string[];
  consultable: boolean;
};

const open: Row = {
  id: "open",
  userId: "owner",
  audienceRestricted: false,
  audienceRoleIds: [],
  audienceUserIds: [],
  consultable: true,
};
const sales: Row = {
  ...open,
  id: "sales",
  audienceRestricted: true,
  audienceRoleIds: ["role-sales"],
};
const solo: Row = { ...open, id: "solo", audienceRestricted: true, consultable: false };
const mine: Row = { ...open, id: "mine", userId: "ana", audienceRestricted: true };

function db(options: { roleIds?: string[]; role?: string } = {}) {
  const rows = [open, sales, solo, mine];
  return {
    bot: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter((row) => where.id.in.includes(row.id)),
      ),
    },
    spaceMember: {
      findUnique: async () => ({
        role: options.role ?? "member",
        roles: (options.roleIds ?? []).map((roleId) => ({ roleId })),
      }),
    },
    spaceRole: {
      findMany: async () => [
        { id: "role-sales", spaceId: "s-1", position: 1, keys: [], systemKey: null },
        {
          id: "everyone",
          spaceId: "s-1",
          position: 99,
          keys: ["talk_to_agents"],
          systemKey: "everyone",
        },
      ],
    },
  } as never;
}

const actor = { spaceId: "s-1", userId: "ana" };
const ids = ["open", "sales", "solo", "mine"];

describe("who may talk to which agent (one rule for every entry point)", () => {
  it("reads each agent's audience from the space only", async () => {
    const prisma = db();
    const audiences = await audiencesOf(prisma, "s-1", ["sales", "ghost"]);
    expect(audiences.get("sales")?.roleIds).toEqual(["role-sales"]);
    expect(audiences.has("ghost")).toBe(false);
    expect(
      (prisma as never as { bot: { findMany: ReturnType<typeof vi.fn> } }).bot.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["sales", "ghost"] }, spaceId: "s-1" } }),
    );
  });

  it("lets an outsider talk only to open agents, and an owner to their own", async () => {
    expect([...(await talkableBotIds(db(), actor, ids))].sort()).toEqual(["mine", "open"]);
  });

  it("lets a role holder talk to the agent that names the role", async () => {
    expect([...(await talkableBotIds(db({ roleIds: ["role-sales"] }), actor, ids))].sort()).toEqual(
      ["mine", "open", "sales"],
    );
  });

  it("lets another agent consult a consultable agent for an outsider, never a closed one", async () => {
    expect([...(await talkableBotIds(db(), actor, ids, "agent"))].sort()).toEqual([
      "mine",
      "open",
      "sales",
    ]);
  });

  it("refuses with FORBIDDEN, and keeps conversations of closed agents unreadable", async () => {
    await expect(requireCanTalkTo(db(), actor, "sales")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireCanTalkTo(db(), actor, "open")).resolves.toBeUndefined();
    await expect(requireCanTalkTo(db(), actor, "sales", "agent")).resolves.toBeUndefined();
    await expect(requireInAudience(db(), actor, "sales")).rejects.toThrow();
    await expect(requireInAudience(db(), actor, "solo")).rejects.toThrow();
    await expect(requireInAudience(db(), actor, "open")).resolves.toBeUndefined();
    await expect(
      requireInAudience(db({ roleIds: ["role-sales"] }), actor, "sales"),
    ).resolves.toBeUndefined();
  });

  it("treats an agent that is not in the space as not there", async () => {
    await expect(requireInAudience(db(), actor, "ghost")).rejects.toThrow();
    await expect(requireCanTalkTo(db(), actor, "ghost")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets the space's owner and admins into every agent, including ones another person made", async () => {
    for (const role of ["owner", "admin"]) {
      const asRole = db({ role });
      expect([...(await talkableBotIds(asRole, actor, ids))].sort()).toEqual([
        "mine",
        "open",
        "sales",
        "solo",
      ]);
      for (const id of ids) {
        await expect(requireInAudience(asRole, actor, id)).resolves.toBeUndefined();
        await expect(requireCanTalkTo(asRole, actor, id)).resolves.toBeUndefined();
      }
    }
  });

  it("answers from the agent row a caller already loaded, without asking the database again", async () => {
    const prisma = db();
    await expect(requireInAudience(prisma, actor, "open", open)).resolves.toBeUndefined();
    await expect(requireInAudience(prisma, actor, "sales", sales)).rejects.toThrow();
    await expect(
      requireInAudience(db({ roleIds: ["role-sales"] }), actor, "sales", sales),
    ).resolves.toBeUndefined();
    expect(
      (prisma as never as { bot: { findMany: ReturnType<typeof vi.fn> } }).bot.findMany,
    ).not.toHaveBeenCalled();
  });
});
