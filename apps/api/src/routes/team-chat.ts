import type { ProductEvent } from "@corvo/contracts";
import { can } from "@corvo/core";
import {
  addChannelPeople,
  appendEventInTransaction,
  channelVisibleTo,
  createThreadMessageInTransaction,
  IsolationError,
  listChannelPeople,
  listDirectPeople,
  loadGroupViewer,
  markDirectRead,
  markDirectUnreadFor,
  openChannelToSpace,
  openDirectThread,
  removeChannelPerson,
  requireDirectThread,
  setChannelRoles,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { ORPCError } from "@orpc/server";
import { accessRevocations } from "../access-revocations.js";
import { getSpaceMembership, requireSpacePermission } from "../space-owner.js";
import { listPendingApprovals } from "../team-chat.js";
import { loadMessagePage, withAuthor } from "../thread-message-pages.js";
import type { RouterContext } from "./context.js";
import { HEARTBEAT_MS, SESSION_RECHECK_MS, THREAD_MESSAGE_PAGE_SIZE } from "./shared.js";

export function teamChatRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const prisma = deps.prisma;

  /** Whoever created the channel, or anyone who manages channels, changes who is in it. */
  async function manageable(actor: { spaceId: string; userId: string }, groupId: string) {
    const group = await prisma.chatGroup.findFirst({
      where: {
        id: groupId,
        spaceId: actor.spaceId,
        ...channelVisibleTo(await loadGroupViewer(prisma, actor)),
      },
      select: { userId: true },
    });
    if (!group) throw new IsolationError();
    const membership = await getSpaceMembership(prisma, actor);
    if (!membership) throw new ORPCError("FORBIDDEN");
    return {
      group,
      canManage: group.userId === actor.userId || can(membership, "manage_channels"),
    };
  }
  async function requireManage(actor: { spaceId: string; userId: string }, groupId: string) {
    if (!(await manageable(actor, groupId)).canManage) throw new ORPCError("FORBIDDEN");
  }

  /** A person of the conversation, who must still belong to the space. */
  async function conversation(actor: { spaceId: string; userId: string }, threadId: string) {
    if (!(await getSpaceMembership(prisma, actor))) throw new ORPCError("FORBIDDEN");
    return requireDirectThread(prisma, { ...actor, threadId });
  }

  return {
    groups: {
      people: {
        list: authed.groups.people.list.handler(async ({ context, input }) => {
          const { canManage } = await manageable(context.actor, input.groupId);
          const people = await listChannelPeople(prisma, {
            spaceId: context.actor.spaceId,
            groupId: input.groupId,
          });
          return { ...people, canManage };
        }),
        add: authed.groups.people.add.handler(async ({ context, input }) => {
          await requireManage(context.actor, input.groupId);
          await addChannelPeople(prisma, {
            spaceId: context.actor.spaceId,
            groupId: input.groupId,
            actorId: context.actor.userId,
            userIds: input.userIds,
          });
          return { ok: true as const };
        }),
        remove: authed.groups.people.remove.handler(async ({ context, input }) => {
          await requireManage(context.actor, input.groupId);
          await removeChannelPerson(prisma, {
            spaceId: context.actor.spaceId,
            groupId: input.groupId,
            userId: input.userId,
          });
          return { ok: true as const };
        }),
        setRoles: authed.groups.people.setRoles.handler(async ({ context, input }) => {
          await requireManage(context.actor, input.groupId);
          await setChannelRoles(prisma, {
            spaceId: context.actor.spaceId,
            groupId: input.groupId,
            roleIds: input.roleIds,
          });
          return { ok: true as const };
        }),
        open: authed.groups.people.open.handler(async ({ context, input }) => {
          await requireManage(context.actor, input.groupId);
          await openChannelToSpace(prisma, {
            spaceId: context.actor.spaceId,
            groupId: input.groupId,
          });
          return { ok: true as const };
        }),
      },
    },
    approvals: {
      list: authed.approvals.list.handler(async ({ context }) =>
        listPendingApprovals(prisma, context.actor),
      ),
    },
    directMessages: {
      people: authed.directMessages.people.handler(async ({ context }) => {
        if (!(await getSpaceMembership(prisma, context.actor))) throw new ORPCError("FORBIDDEN");
        return listDirectPeople(prisma, context.actor);
      }),
      open: authed.directMessages.open.handler(async ({ context, input }) => {
        await requireSpacePermission(prisma, context.actor, "post");
        const threadId = await openDirectThread(prisma, {
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          withUserId: input.userId,
        });
        return { threadId };
      }),
      get: authed.directMessages.get.handler(async ({ context, input }) => {
        const row = await conversation(context.actor, input.threadId);
        const [page, last, partner] = await Promise.all([
          loadMessagePage(prisma, input.threadId, input.before, THREAD_MESSAGE_PAGE_SIZE),
          prisma.event.findFirst({
            where: { threadId: input.threadId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          }),
          prisma.user.findUniqueOrThrow({
            where: { id: row.partnerId },
            select: { id: true, name: true, image: true },
          }),
        ]);
        return {
          threadId: input.threadId,
          partner: { userId: partner.id, name: partner.name, image: partner.image },
          cursor: last?.seq ?? -1,
          messages: page.messages,
          olderCursor: page.olderCursor,
        };
      }),
      send: authed.directMessages.send.handler(async ({ context, input }) => {
        const { actor } = context;
        await requireSpacePermission(prisma, actor, "post");
        const row = await conversation(actor, input.threadId);
        const committed = await prisma.$transaction(async (tx) => {
          if (input.clientNonce) {
            const existing = await tx.message.findUnique({
              where: {
                threadId_clientNonce: { threadId: input.threadId, clientNonce: input.clientNonce },
              },
              select: { seq: true },
            });
            if (existing) return { seq: existing.seq, eventSeq: null };
          }
          await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
          const blocks = [{ kind: "text" as const, text: input.text }];
          // The other person's dot is set below, for them alone: the shared rule marks everyone.
          const message = await createThreadMessageInTransaction(tx, {
            threadId: input.threadId,
            role: "user",
            blocks,
            authorUserId: actor.userId,
            clientNonce: input.clientNonce,
            markUnread: false,
          });
          await markDirectUnreadFor(tx, {
            threadId: input.threadId,
            spaceId: actor.spaceId,
            userId: row.partnerId,
            seq: message.seq,
          });
          const event = await appendEventInTransaction(tx, {
            spaceId: actor.spaceId,
            threadId: input.threadId,
            botId: input.threadId,
            type: "thread.message.created",
            payload: {
              messageId: message.id,
              seq: message.seq,
              role: "user",
              authorUserId: actor.userId,
              blocks,
            },
          });
          return { seq: message.seq, eventSeq: event.seq };
        });
        if (committed.eventSeq !== null) {
          await deps.events.notify(input.threadId, committed.eventSeq).catch((error) => {
            // The other person catches up from the durable cursor after a missed wake.
            getLogger().error("direct message realtime notification", error);
          });
        }
        return { seq: committed.seq };
      }),
      subscribe: authed.directMessages.subscribe.handler(async function* ({ context, input }) {
        const { actor } = context;
        await conversation(actor, input.threadId);
        const authorCache = new Map<
          string,
          Promise<{ name: string; image: string | null } | null>
        >();
        const follow = deps.events.follow(input.threadId, input.cursor, context.signal);
        const revoked = accessRevocations
          .watch(actor.spaceId, actor.userId, context.signal)
          .then(() => "revoked" as const);
        let pending: Promise<IteratorResult<ProductEvent>> | undefined;
        // Auth ran when the stream opened. Check it, and that the person is still one of the two,
        // before more is delivered, so a removed or signed-out person stops within the interval.
        let authorizedAt = Date.now();
        const assertStillAuthorized = async () => {
          if (Date.now() - authorizedAt < SESSION_RECHECK_MS) return;
          if (context.stillAuthorized && !(await context.stillAuthorized())) {
            throw new ORPCError("UNAUTHORIZED");
          }
          await conversation(actor, input.threadId);
          authorizedAt = Date.now();
        };
        try {
          while (!context.signal?.aborted) {
            pending ??= follow.next();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const next = await Promise.race([
              pending,
              revoked,
              new Promise<"silent">((resolve) => {
                timer = setTimeout(() => resolve("silent"), HEARTBEAT_MS);
              }),
            ]).finally(() => clearTimeout(timer));
            // Removed from the space: end the stream now, not at the next periodic re-check.
            if (next === "revoked") throw new ORPCError("UNAUTHORIZED");
            if (next === "silent") {
              await assertStillAuthorized();
              yield {
                id: "heartbeat",
                spaceId: actor.spaceId,
                threadId: input.threadId,
                botId: input.threadId,
                seq: 0,
                type: "heartbeat",
                createdAt: new Date().toISOString(),
                payload: {},
              };
              continue;
            }
            pending = undefined;
            if (next.done) return;
            await assertStillAuthorized();
            yield await withAuthor(prisma, next.value, authorCache);
          }
        } finally {
          void follow.return(undefined).catch(() => {});
        }
      }),
      markRead: authed.directMessages.markRead.handler(async ({ context, input }) => {
        await conversation(context.actor, input.threadId);
        await markDirectRead(prisma, {
          threadId: input.threadId,
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
        });
        return { ok: true as const };
      }),
    },
  };
}
