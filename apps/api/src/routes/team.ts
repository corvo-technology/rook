import type { SpaceInvitation } from "@corvo/contracts";
import { MAX_INVITE_ADDRESSES } from "@corvo/contracts";
import { parseInviteAddresses } from "@corvo/core";
import type { InvitationRow } from "@corvo/db";
import {
  activeInviteLink,
  answerJoinRequest,
  cancelInvitation,
  createInvitations,
  createInviteLink,
  createSpaceRole,
  deleteSpaceRole,
  disableInviteLink,
  listInvitations,
  listJoinRequests,
  listSpaceMembers,
  listSpaceRoles,
  removeMember,
  reorderSpaceRoles,
  resendInvitation,
  runAsSystem,
  setMemberRole,
  setMemberRoles,
  TeamError,
  updateSpaceRole,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { accessRevocations } from "../access-revocations.js";
import { getSpaceMembership } from "../space-owner.js";
import type { TeamDeps } from "../team.js";
import { HitLimiter, invitationUrl, joinUrl, sendInvitationEmail, syncSeats } from "../team.js";
import type { RouterContext } from "./context.js";

function refuse(error: unknown): never {
  if (!(error instanceof TeamError)) throw error;
  const code = {
    forbidden: "FORBIDDEN",
    not_found: "NOT_FOUND",
    invalid: "BAD_REQUEST",
    limit: "TOO_MANY_REQUESTS",
    last_owner: "CONFLICT",
    closed: "CONFLICT",
  } as const;
  throw new ORPCError(code[error.code], { message: error.message });
}

function requireTeam(team: TeamDeps | undefined): TeamDeps {
  if (!team) throw new ORPCError("NOT_FOUND");
  return team;
}

/** Membership rules decide inside the database functions; these run as the system so a new member's own rows can be written. */
function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem("change who belongs to a space", fn).catch(refuse);
}

function invitationDto(team: TeamDeps, row: InvitationRow): SpaceInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    roleIds: row.roleIds,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedByName: row.acceptedByName,
    link: row.status === "pending" ? invitationUrl(team, row.id) : null,
  };
}

/** An invitation email goes to the same address at most this often, so sending again is no way to spam it. */
const EMAILS_PER_INVITATION_PER_HOUR = 3;

export function teamRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const spaces = authed.spaces;
  const emailSends = new HitLimiter(EMAILS_PER_INVITATION_PER_HOUR, 60 * 60_000);

  async function mailAndAnswer(
    team: TeamDeps,
    actor: { userId: string; spaceId: string },
    rows: InvitationRow[],
    alreadyMembers: string[],
    /** False when the caller already took its turn from the limiter. */
    limited = true,
  ) {
    const [inviter, space] = await Promise.all([
      deps.prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { name: true },
      }),
      deps.prisma.space.findUniqueOrThrow({
        where: { id: actor.spaceId },
        select: { name: true },
      }),
    ]);
    for (const row of rows) {
      // An address invited again keeps its invitation; its mailbox is not written to every time.
      if (limited && !emailSends.allow(`${actor.spaceId}:${row.id}`)) continue;
      await sendInvitationEmail(team, {
        id: row.id,
        email: row.email,
        inviterName: inviter.name,
        spaceName: space.name,
      });
    }
    return {
      emailed: Boolean(team.email),
      invitations: rows.map((row) => invitationDto(team, row)),
      alreadyMembers,
    };
  }

  async function changed(team: TeamDeps | undefined, spaceId: string) {
    if (!team) return;
    const space = await deps.prisma.space.findUnique({
      where: { id: spaceId },
      select: { organizationId: true },
    });
    if (space) syncSeats(team, space.organizationId);
  }

  return {
    spaces: {
      members: {
        list: spaces.members.list.handler(async ({ context }) =>
          (await listSpaceMembers(deps.prisma, context.actor.spaceId)).map((member) => ({
            ...member,
            joinedAt: member.joinedAt.toISOString(),
          })),
        ),
        setRole: spaces.members.setRole.handler(async ({ context, input }) => {
          await asSystem(() =>
            setMemberRole(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              userId: input.userId,
              role: input.role,
            }),
          );
          return { ok: true as const };
        }),
        setRoles: spaces.members.setRoles.handler(async ({ context, input }) => {
          await asSystem(() =>
            setMemberRoles(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              userId: input.userId,
              roleIds: input.roleIds,
            }),
          );
          return { ok: true as const };
        }),
        remove: spaces.members.remove.handler(async ({ context, input }) => {
          await asSystem(() =>
            removeMember(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              userId: input.userId,
            }),
          );
          accessRevocations.revoke(context.actor.spaceId, input.userId);
          await changed(deps.team, context.actor.spaceId);
          return { ok: true as const };
        }),
        leave: spaces.members.leave.handler(async ({ context }) => {
          await asSystem(() =>
            removeMember(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              userId: context.actor.userId,
            }),
          );
          accessRevocations.revoke(context.actor.spaceId, context.actor.userId);
          await changed(deps.team, context.actor.spaceId);
          return { ok: true as const };
        }),
      },
      roles: {
        list: spaces.roles.list.handler(async ({ context }) => {
          const me = await getSpaceMembership(deps.prisma, context.actor);
          if (!me) throw new ORPCError("FORBIDDEN");
          const roles = await asSystem(() => listSpaceRoles(deps.prisma, context.actor.spaceId));
          return {
            roles,
            me: { isOwner: me.isOwner, roleIds: [...me.roleIds], permissions: [...me.permissions] },
          };
        }),
        create: spaces.roles.create.handler(async ({ context, input }) => ({
          id: await asSystem(() =>
            createSpaceRole(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              name: input.name,
              keys: input.keys,
              color: input.color,
            }),
          ),
        })),
        update: spaces.roles.update.handler(async ({ context, input }) => {
          await asSystem(() =>
            updateSpaceRole(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              id: input.id,
              name: input.name,
              keys: input.keys,
              color: input.color,
            }),
          );
          return { ok: true as const };
        }),
        remove: spaces.roles.remove.handler(async ({ context, input }) => {
          await asSystem(() =>
            deleteSpaceRole(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              id: input.id,
            }),
          );
          return { ok: true as const };
        }),
        reorder: spaces.roles.reorder.handler(async ({ context, input }) => {
          await asSystem(() =>
            reorderSpaceRoles(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              ids: input.ids,
            }),
          );
          return { ok: true as const };
        }),
      },
      invitations: {
        list: spaces.invitations.list.handler(async ({ context }) => {
          const team = requireTeam(deps.team);
          const rows = await asSystem(() =>
            listInvitations(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
            }),
          );
          return rows.map((row) => invitationDto(team, row));
        }),
        create: spaces.invitations.create.handler(async ({ context, input }) => {
          const team = requireTeam(deps.team);
          const parsed = parseInviteAddresses(input.addresses);
          if (parsed.addresses.length === 0 || parsed.rejected.length > 0) {
            throw new ORPCError("BAD_REQUEST", { message: "Check the addresses" });
          }
          if (parsed.addresses.length > MAX_INVITE_ADDRESSES) {
            throw new ORPCError("BAD_REQUEST", { message: "Too many addresses" });
          }
          const result = await asSystem(() =>
            createInvitations(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              role: input.role,
              roleIds: input.roleIds,
              addresses: parsed.addresses,
            }),
          );
          return mailAndAnswer(team, context.actor, result.invitations, result.alreadyMembers);
        }),
        resend: spaces.invitations.resend.handler(async ({ context, input }) => {
          const team = requireTeam(deps.team);
          if (!emailSends.allow(`${context.actor.spaceId}:${input.id}`)) {
            throw new ORPCError("TOO_MANY_REQUESTS", { message: "Sent too often" });
          }
          const row = await asSystem(() =>
            resendInvitation(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              id: input.id,
            }),
          );
          return mailAndAnswer(team, context.actor, [row], [], false);
        }),
        cancel: spaces.invitations.cancel.handler(async ({ context, input }) => {
          await asSystem(() =>
            cancelInvitation(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              id: input.id,
            }),
          );
          return { ok: true as const };
        }),
      },
      inviteLink: {
        get: spaces.inviteLink.get.handler(async ({ context }) => {
          const team = requireTeam(deps.team);
          const link = await asSystem(() =>
            activeInviteLink(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
            }),
          );
          return { link: link ? joinUrl(team, link.id) : null };
        }),
        create: spaces.inviteLink.create.handler(async ({ context }) => {
          const team = requireTeam(deps.team);
          const link = await asSystem(() =>
            createInviteLink(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
            }),
          );
          return { link: joinUrl(team, link.id) };
        }),
        disable: spaces.inviteLink.disable.handler(async ({ context }) => {
          await asSystem(() =>
            disableInviteLink(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
            }),
          );
          return { ok: true as const };
        }),
      },
      joinRequests: {
        list: spaces.joinRequests.list.handler(async ({ context }) =>
          (
            await asSystem(() =>
              listJoinRequests(deps.prisma, {
                spaceId: context.actor.spaceId,
                actorId: context.actor.userId,
              }),
            )
          ).map((request) => ({ ...request, createdAt: request.createdAt.toISOString() })),
        ),
        answer: spaces.joinRequests.answer.handler(async ({ context, input }) => {
          await asSystem(() =>
            answerJoinRequest(deps.prisma, {
              spaceId: context.actor.spaceId,
              actorId: context.actor.userId,
              id: input.id,
              approve: input.approve,
              reason: input.reason,
            }),
          );
          if (input.approve) await changed(deps.team, context.actor.spaceId);
          return { ok: true as const };
        }),
      },
    },
  };
}
