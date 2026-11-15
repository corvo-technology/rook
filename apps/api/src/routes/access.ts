import type { ConnectionAccess } from "@corvo/contracts";
import { can, mcpGrantLevel, storedAccessLevel } from "@corvo/core";
import { IsolationError } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { revertConnectedMcpApprovals } from "../mcp-approval.js";
import { getSpaceMembership } from "../space-owner.js";
import type { RouterContext } from "./context.js";

/**
 * Which agents may use each connection, and how far: one model over MCP servers, mailboxes and
 * databases. Who may use a connection stays with its owner (or `manage_connections` for a
 * database); what a level allows is enforced where the tools are listed and called.
 */
export function accessRoutes(ctx: RouterContext) {
  const { deps, onboardingDeps, authed } = ctx;
  const { prisma } = deps;

  return {
    access: {
      list: authed.access.list.handler(async ({ context }): Promise<ConnectionAccess[]> => {
        const { actor } = context;
        const owned = { spaceId: actor.spaceId, bot: { archivedAt: null, userId: actor.userId } };
        const membership = await getSpaceMembership(prisma, actor);
        const [servers, mailboxes, databases] = await Promise.all([
          prisma.botMcpServer.findMany({
            where: { ...owned, userId: actor.userId },
            select: { botId: true, serverId: true, allowAllTools: true, level: true },
          }),
          prisma.botMailbox.findMany({
            where: { ...owned, mailbox: { userId: actor.userId } },
            select: { botId: true, mailboxId: true, level: true },
          }),
          can(membership, "manage_connections")
            ? prisma.botDatabaseGrant.findMany({
                where: { spaceId: actor.spaceId, bot: { archivedAt: null } },
                select: { botId: true, connectionId: true },
              })
            : [],
        ]);
        return [
          ...servers.map((row) => ({
            kind: "mcp" as const,
            connectionId: row.serverId,
            botId: row.botId,
            level: mcpGrantLevel(row),
          })),
          ...mailboxes.map((row) => ({
            kind: "mailbox" as const,
            connectionId: row.mailboxId,
            botId: row.botId,
            level: storedAccessLevel(row.level),
          })),
          ...databases.map((row) => ({
            kind: "database" as const,
            connectionId: row.connectionId,
            botId: row.botId,
            level: "read" as const,
          })),
        ];
      }),

      set: authed.access.set.handler(async ({ context, input }) => {
        const { actor } = context;
        const botIds = [...new Set(input.botIds)];
        const level = input.level;
        const manages =
          input.kind === "database" &&
          can(await getSpaceMembership(prisma, actor), "manage_connections");
        const seqs = await prisma.$transaction(async (tx) => {
          if (input.kind === "database") {
            // Agents only ever read a database, and only people who manage connections hand it out.
            if (level === "write") {
              throw new ORPCError("BAD_REQUEST", { message: "A database is only read" });
            }
            if (!manages) throw new ORPCError("FORBIDDEN");
            const [connection, bots] = await Promise.all([
              tx.databaseConnection.findFirst({
                where: { id: input.connectionId, spaceId: actor.spaceId },
                select: { id: true },
              }),
              tx.bot.findMany({
                where: { id: { in: botIds }, spaceId: actor.spaceId, archivedAt: null },
                select: { id: true },
              }),
            ]);
            if (!connection || bots.length !== botIds.length) throw new IsolationError();
            if (level === "none") {
              await tx.botDatabaseGrant.deleteMany({
                where: { connectionId: connection.id, botId: { in: botIds } },
              });
            } else {
              await tx.botDatabaseGrant.createMany({
                data: botIds.map((botId) => ({
                  spaceId: actor.spaceId,
                  botId,
                  connectionId: connection.id,
                })),
                skipDuplicates: true,
              });
            }
            return [];
          }
          // MCP servers and mailboxes are lent only by their owner, to agents the owner owns.
          const bots = await tx.bot.findMany({
            where: {
              id: { in: botIds },
              spaceId: actor.spaceId,
              userId: actor.userId,
              archivedAt: null,
            },
            select: { id: true },
          });
          if (bots.length !== botIds.length) throw new IsolationError();
          if (input.kind === "mailbox") {
            const mailbox = await tx.mailbox.findFirst({
              where: { id: input.connectionId, spaceId: actor.spaceId, userId: actor.userId },
              select: { id: true },
            });
            if (!mailbox) throw new IsolationError();
            if (level === "none") {
              await tx.botMailbox.deleteMany({
                where: { mailboxId: mailbox.id, botId: { in: botIds } },
              });
            } else {
              await tx.botMailbox.createMany({
                data: botIds.map((botId) => ({
                  spaceId: actor.spaceId,
                  mailboxId: mailbox.id,
                  botId,
                  level,
                })),
                skipDuplicates: true,
              });
              await tx.botMailbox.updateMany({
                where: { mailboxId: mailbox.id, botId: { in: botIds } },
                data: { level },
              });
            }
            return [];
          }
          const server = await tx.mcpServer.findFirst({
            where: { id: input.connectionId, spaceId: actor.spaceId, userId: actor.userId },
            select: { id: true },
          });
          if (!server) throw new IsolationError();
          if (level === "none") {
            await tx.botMcpServer.deleteMany({
              where: { serverId: server.id, botId: { in: botIds } },
            });
            return (
              await Promise.all(
                botIds.map((botId) =>
                  revertConnectedMcpApprovals(
                    onboardingDeps,
                    actor,
                    { botId, serverId: server.id, status: "pending" },
                    tx,
                  ),
                ),
              )
            ).flat();
          }
          // Picking a level replaces a per-tool list from an older version.
          const base = { allowAllTools: true, allowedTools: [], level };
          await tx.botMcpServer.createMany({
            data: botIds.map((botId) => ({
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId,
              serverId: server.id,
              ...base,
            })),
            skipDuplicates: true,
          });
          await tx.botMcpServer.updateMany({
            where: { serverId: server.id, botId: { in: botIds } },
            data: base,
          });
          return [];
        });
        for (const event of seqs) await deps.events.notify(event.threadId, event.seq);
        return { ok: true as const };
      }),
    },
  };
}
