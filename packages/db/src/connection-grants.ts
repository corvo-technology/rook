import type { Prisma } from "./client.js";
import { IsolationError } from "./scope.js";

type Tx = Pick<
  Prisma.TransactionClient,
  | "bot"
  | "mailbox"
  | "mcpServer"
  | "databaseConnection"
  | "botMailbox"
  | "botMcpServer"
  | "botDatabaseGrant"
>;

export type ConnectionGrant = {
  kind: "mcp" | "mailbox" | "database";
  connectionId: string;
  level: "read" | "write";
};

/**
 * Lend one connection to agents of a space, the one write behind the Access screen and an agent
 * proposal card. MCP servers and mailboxes are lent only by their owner to agents that owner
 * owns; a database is only ever read, and the caller has already checked that its member may hand
 * databases out. Anything outside the space or the owner's reach is an `IsolationError`.
 */
export async function grantConnectionAccess(
  tx: Tx,
  scope: { spaceId: string; userId: string },
  botIds: string[],
  grant: ConnectionGrant,
): Promise<void> {
  const { spaceId, userId } = scope;
  const { connectionId, level } = grant;
  if (grant.kind === "database") {
    if (level === "write") throw new IsolationError();
    const [connection, bots] = await Promise.all([
      tx.databaseConnection.findFirst({
        where: { id: connectionId, spaceId },
        select: { id: true },
      }),
      tx.bot.findMany({
        where: { id: { in: botIds }, spaceId, archivedAt: null },
        select: { id: true },
      }),
    ]);
    if (!connection || bots.length !== botIds.length) throw new IsolationError();
    await tx.botDatabaseGrant.createMany({
      data: botIds.map((botId) => ({ spaceId, botId, connectionId: connection.id })),
      skipDuplicates: true,
    });
    return;
  }
  const bots = await tx.bot.findMany({
    where: { id: { in: botIds }, spaceId, userId, archivedAt: null },
    select: { id: true },
  });
  if (bots.length !== botIds.length) throw new IsolationError();
  if (grant.kind === "mailbox") {
    const mailbox = await tx.mailbox.findFirst({
      where: { id: connectionId, spaceId, userId },
      select: { id: true },
    });
    if (!mailbox) throw new IsolationError();
    await tx.botMailbox.createMany({
      data: botIds.map((botId) => ({ spaceId, mailboxId: mailbox.id, botId, level })),
      skipDuplicates: true,
    });
    await tx.botMailbox.updateMany({
      where: { mailboxId: mailbox.id, botId: { in: botIds } },
      data: { level },
    });
    return;
  }
  const server = await tx.mcpServer.findFirst({
    where: { id: connectionId, spaceId, userId },
    select: { id: true },
  });
  if (!server) throw new IsolationError();
  // Picking a level replaces a per-tool list from an older version.
  const base = { allowAllTools: true, allowedTools: [], level };
  await tx.botMcpServer.createMany({
    data: botIds.map((botId) => ({ spaceId, userId, botId, serverId: server.id, ...base })),
    skipDuplicates: true,
  });
  await tx.botMcpServer.updateMany({
    where: { serverId: server.id, botId: { in: botIds } },
    data: base,
  });
}
