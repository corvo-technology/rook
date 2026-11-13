import type { Actor, MemberUsage, WorkspaceModel } from "@corvo/contracts";
import { utcMonthStart } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { setMemberModelSetting, setSpaceModelConnection, spaceMemberTokensSince } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { requireSpaceOwner } from "./space-owner.js";

type Deps = { prisma: PrismaClient };

async function isOwner(prisma: PrismaClient, actor: Actor): Promise<boolean> {
  try {
    await requireSpaceOwner(prisma, actor);
    return true;
  } catch {
    return false;
  }
}

/** Where the asking member stands on the models the space's owner may lend. */
export async function workspaceModelFor(deps: Deps, actor: Actor): Promise<WorkspaceModel> {
  const [connection, setting, owner] = await Promise.all([
    deps.prisma.spaceModelConnection.findUnique({
      where: { spaceId: actor.spaceId },
      select: { ownerUserId: true },
    }),
    deps.prisma.spaceMemberModelSetting.findUnique({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      select: { useOwnModel: true },
    }),
    isOwner(deps.prisma, actor),
  ]);
  return { isOwner: owner, shared: Boolean(connection), useOwn: setting?.useOwnModel ?? false };
}

/** The owner lends their models to the space's members, or takes them back. */
export async function shareWorkspaceModel(deps: Deps, actor: Actor, shared: boolean) {
  await requireSpaceOwner(deps.prisma, actor);
  await setSpaceModelConnection(deps.prisma, actor, shared);
  return workspaceModelFor(deps, actor);
}

/** A member runs on their own models instead of the lent ones, or goes back to the lent ones. */
export async function chooseOwnModel(deps: Deps, actor: Actor, useOwn: boolean) {
  await setMemberModelSetting(deps.prisma, actor, { useOwnModel: useOwn });
  return workspaceModelFor(deps, actor);
}

/** Each member's tokens this month with the limit the owner set; for owners only. */
export async function listMemberUsage(deps: Deps, actor: Actor): Promise<MemberUsage[]> {
  await requireSpaceOwner(deps.prisma, actor);
  const [members, tokens] = await Promise.all([
    deps.prisma.spaceMember.findMany({
      where: { spaceId: actor.spaceId },
      select: {
        userId: true,
        member: { select: { user: { select: { name: true } } } },
        modelSetting: { select: { useOwnModel: true, monthlyTokenLimit: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    spaceMemberTokensSince(deps.prisma, actor.spaceId, utcMonthStart(new Date())),
  ]);
  return members.map((row) => ({
    userId: row.userId,
    name: row.member.user.name,
    monthTokens: tokens.get(row.userId) ?? 0,
    monthlyTokenLimit:
      row.modelSetting?.monthlyTokenLimit == null
        ? null
        : Number(row.modelSetting.monthlyTokenLimit),
    useOwn: row.modelSetting?.useOwnModel ?? false,
  }));
}

/** Caps what one member may use of the lent models in a UTC month; the owner is never capped. */
export async function limitMemberUsage(
  deps: Deps,
  actor: Actor,
  input: { userId: string; monthlyTokenLimit: number | null },
) {
  await requireSpaceOwner(deps.prisma, actor);
  const member = await deps.prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: input.userId } },
    select: { userId: true },
  });
  if (!member) throw new ORPCError("NOT_FOUND");
  const connection = await deps.prisma.spaceModelConnection.findUnique({
    where: { spaceId: actor.spaceId },
    select: { ownerUserId: true },
  });
  if (connection?.ownerUserId === input.userId) throw new ORPCError("BAD_REQUEST");
  await setMemberModelSetting(
    deps.prisma,
    { spaceId: actor.spaceId, userId: input.userId },
    { monthlyTokenLimit: input.monthlyTokenLimit },
  );
  return { ok: true as const };
}
