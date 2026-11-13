import type { Actor } from "@corvo/contracts";
import { WorkspaceModelSchema } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it } from "vitest";
import {
  chooseOwnModel,
  limitMemberUsage,
  listMemberUsage,
  shareWorkspaceModel,
  workspaceModelFor,
} from "./workspace-model.js";

const actor = (userId: string): Actor => ({ userId, spaceId: "space-1" }) as Actor;

function fakeDb() {
  const roles: Record<string, string> = { owner: "owner", admin: "member", member: "member" };
  const state = {
    connection: null as { ownerUserId: string } | null,
    settings: new Map<string, { useOwnModel: boolean; monthlyTokenLimit: bigint | null }>(),
  };
  const prisma = {
    spaceMember: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_userId: { spaceId: string; userId: string } };
      }) => {
        const userId = where.spaceId_userId.userId;
        return userId in roles ? { role: roles[userId], userId } : null;
      },
      findMany: async () =>
        Object.keys(roles).map((userId) => ({
          userId,
          member: { user: { name: `Name ${userId}` } },
          modelSetting: state.settings.get(userId) ?? null,
        })),
    },
    spaceModelConnection: {
      findUnique: async () => state.connection,
      upsert: async ({ create }: { create: { ownerUserId: string } }) => {
        state.connection = { ownerUserId: create.ownerUserId };
      },
      deleteMany: async () => {
        state.connection = null;
      },
    },
    spaceMemberModelSetting: {
      findUnique: async ({
        where,
      }: {
        where: { spaceId_userId: { spaceId: string; userId: string } };
      }) => state.settings.get(where.spaceId_userId.userId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { spaceId_userId: { spaceId: string; userId: string } };
        create: { useOwnModel?: boolean; monthlyTokenLimit?: bigint | null };
        update: { useOwnModel?: boolean; monthlyTokenLimit?: bigint | null };
      }) => {
        const key = where.spaceId_userId.userId;
        const current = state.settings.get(key);
        state.settings.set(key, {
          useOwnModel: false,
          monthlyTokenLimit: null,
          ...(current ?? create),
          ...update,
        });
      },
    },
    $queryRaw: async () => [{ userId: "member", tokens: 1_200n }],
  };
  return { deps: { prisma: prisma as unknown as PrismaClient }, state };
}

describe("a workspace's lent models", () => {
  it("lets only an owner lend or take them back", async () => {
    const { deps } = fakeDb();
    await expect(shareWorkspaceModel(deps, actor("member"), true)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await shareWorkspaceModel(deps, actor("owner"), true)).toMatchObject({
      isOwner: true,
      shared: true,
    });
    expect(await shareWorkspaceModel(deps, actor("owner"), false)).toMatchObject({
      shared: false,
    });
  });

  it("tells a member only whether models are lent, never anything of the connection", async () => {
    const { deps } = fakeDb();
    await shareWorkspaceModel(deps, actor("owner"), true);
    const view = await workspaceModelFor(deps, actor("member"));
    expect(Object.keys(WorkspaceModelSchema.parse(view)).sort()).toEqual([
      "isOwner",
      "shared",
      "useOwn",
    ]);
    expect(view).toEqual({ isOwner: false, shared: true, useOwn: false });
  });

  it("lets any member choose their own models for themselves", async () => {
    const { deps, state } = fakeDb();
    expect(await chooseOwnModel(deps, actor("member"), true)).toMatchObject({ useOwn: true });
    expect(state.settings.get("member")?.useOwnModel).toBe(true);
    expect(state.settings.has("owner")).toBe(false);
  });

  it("shows each member's month to an owner and to no one else", async () => {
    const { deps } = fakeDb();
    await expect(listMemberUsage(deps, actor("member"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const rows = await listMemberUsage(deps, actor("owner"));
    expect(rows.find((row) => row.userId === "member")).toMatchObject({
      name: "Name member",
      monthTokens: 1_200,
      monthlyTokenLimit: null,
    });
    expect(rows.find((row) => row.userId === "admin")?.monthTokens).toBe(0);
  });

  it("lets only an owner set a member's limit, and never one on the owner", async () => {
    const { deps, state } = fakeDb();
    await shareWorkspaceModel(deps, actor("owner"), true);
    await expect(
      limitMemberUsage(deps, actor("member"), { userId: "member", monthlyTokenLimit: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      limitMemberUsage(deps, actor("owner"), { userId: "owner", monthlyTokenLimit: 5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      limitMemberUsage(deps, actor("owner"), { userId: "stranger", monthlyTokenLimit: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await limitMemberUsage(deps, actor("owner"), { userId: "member", monthlyTokenLimit: 5_000 });
    expect(state.settings.get("member")?.monthlyTokenLimit).toBe(5_000n);
    await limitMemberUsage(deps, actor("owner"), { userId: "member", monthlyTokenLimit: null });
    expect(state.settings.get("member")?.monthlyTokenLimit).toBeNull();
  });
});
