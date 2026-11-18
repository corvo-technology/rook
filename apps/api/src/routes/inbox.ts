import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  readHomeChecklist,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { getSpaceMembership } from "../space-owner.js";
import type { RouterContext } from "./context.js";

export function inboxRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const prisma = deps.prisma;

  async function requireMember(actor: { spaceId: string; userId: string }) {
    if (!(await getSpaceMembership(prisma, actor))) throw new ORPCError("FORBIDDEN");
  }

  return {
    home: {
      checklist: authed.home.checklist.handler(async ({ context }) => {
        await requireMember(context.actor);
        return readHomeChecklist(prisma, context.actor);
      }),
    },
    inbox: {
      list: authed.inbox.list.handler(async ({ context }) => {
        await requireMember(context.actor);
        return listNotifications(prisma, context.actor);
      }),
      markRead: authed.inbox.markRead.handler(async ({ context, input }) => {
        await requireMember(context.actor);
        await markNotificationsRead(prisma, { ...context.actor, ...input });
        return { ok: true as const };
      }),
      markAllRead: authed.inbox.markAllRead.handler(async ({ context }) => {
        await requireMember(context.actor);
        await markAllNotificationsRead(prisma, context.actor);
        return { ok: true as const };
      }),
    },
    presence: {
      list: authed.presence.list.handler(async ({ context }) => {
        await requireMember(context.actor);
        const members = await prisma.spaceMember.findMany({
          where: { spaceId: context.actor.spaceId },
          select: { userId: true, lastSeenAt: true },
        });
        return members.map((member) => ({
          userId: member.userId,
          status:
            deps.presence?.statusOf(context.actor.spaceId, member.userId, member.lastSeenAt) ??
            ("offline" as const),
          lastSeenAt: member.lastSeenAt?.toISOString() ?? null,
        }));
      }),
      touch: authed.presence.touch.handler(async ({ context, input }) => {
        deps.presence?.touch(context.actor.spaceId, context.actor.userId, input.active);
        return { ok: true as const };
      }),
    },
  };
}
