import type { SecretStore } from "@corvo/adapter-kit";
import type { Mailbox as MailboxAccess } from "@corvo/adapters";
import { ImapSmtpMailbox, mailboxErrorMessage } from "@corvo/adapters";
import type { Actor, MailboxDto, MailboxInputValue } from "@corvo/contracts";
import { MailboxConfigSchema } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { ORPCError } from "@orpc/server";

type Scope = Pick<Actor, "spaceId" | "userId">;

export interface MailboxServiceDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
  /** Same switch as private MCP endpoints: a mail server on this machine or LAN. */
  allowPrivateEndpoint: boolean;
  resolveHostname?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Tests replace the network. */
  open?: (account: ConstructorParameters<typeof ImapSmtpMailbox>[0]) => MailboxAccess;
}

type Row = {
  id: string;
  address: string;
  config: unknown;
  createdAt: Date;
  grants: Array<{ botId: string }>;
};

function toDto(row: Row): MailboxDto {
  const config = MailboxConfigSchema.parse(row.config);
  return {
    id: row.id,
    address: row.address,
    imap: config.imap,
    smtp: config.smtp,
    username: config.username,
    botIds: row.grants.map((grant) => grant.botId),
    createdAt: row.createdAt.toISOString(),
  };
}

export function createMailboxService(deps: MailboxServiceDeps) {
  const { prisma } = deps;
  const include = { grants: { select: { botId: true } } } as const;
  const owned = (scope: Scope, id: string) => ({
    id,
    spaceId: scope.spaceId,
    userId: scope.userId,
  });

  async function load(scope: Scope, id: string): Promise<Row> {
    const row = await prisma.mailbox.findFirst({ where: owned(scope, id), include });
    if (!row) throw new ORPCError("NOT_FOUND");
    return row;
  }

  return {
    async list(scope: Scope): Promise<MailboxDto[]> {
      const rows = await prisma.mailbox.findMany({
        where: { spaceId: scope.spaceId, userId: scope.userId },
        orderBy: { createdAt: "asc" },
        include,
      });
      return rows.map(toDto);
    },

    async create(
      scope: Scope,
      input: MailboxInputValue,
      signal: AbortSignal,
      operation = "mailboxes.create",
    ): Promise<MailboxDto> {
      const account = {
        address: input.address,
        username: input.username,
        password: input.password,
        imap: input.imap,
        smtp: input.smtp,
      };
      const mailbox =
        deps.open?.(account) ??
        new ImapSmtpMailbox(account, {
          allowPrivateEndpoint: deps.allowPrivateEndpoint,
          resolveHostname: deps.resolveHostname,
        });
      try {
        await mailbox.verify();
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Could not sign in: ${mailboxErrorMessage(error, [input.password])}`,
        });
      } finally {
        await mailbox.close();
      }
      const stored = await deps.secrets.put(input.password, {
        operationId: operation,
        traceId: operation,
        spaceId: scope.spaceId,
        userId: scope.userId,
        signal,
      });
      const config = MailboxConfigSchema.parse({
        imap: input.imap,
        smtp: input.smtp,
        username: input.username,
      });
      const row = await prisma.$transaction(async (tx) => {
        await tx.secret.create({
          data: {
            id: stored.id,
            spaceId: scope.spaceId,
            userId: scope.userId,
            kind: "mailbox",
            ciphertext: stored.ciphertext,
          },
        });
        return tx.mailbox.create({
          data: {
            spaceId: scope.spaceId,
            userId: scope.userId,
            name: input.address,
            address: input.address,
            config,
            secretId: stored.id,
          },
          include,
        });
      });
      return toDto(row);
    },

    async remove(scope: Scope, id: string): Promise<void> {
      const row = await prisma.mailbox.findFirst({ where: owned(scope, id) });
      if (!row) return;
      await prisma.$transaction(async (tx) => {
        await tx.mailbox.delete({ where: { id: row.id } });
        if (row.secretId) {
          await tx.secret.deleteMany({
            where: { id: row.secretId, spaceId: scope.spaceId, userId: scope.userId },
          });
        }
      });
    },

    async setAgents(scope: Scope, id: string, botIds: string[]): Promise<MailboxDto> {
      const row = await load(scope, id);
      const wanted = [...new Set(botIds)];
      // Only agents the owner owns: a mailbox is never lent to someone else's agent.
      const bots = wanted.length
        ? await prisma.bot.findMany({
            where: {
              id: { in: wanted },
              spaceId: scope.spaceId,
              userId: scope.userId,
              archivedAt: null,
            },
            select: { id: true },
          })
        : [];
      if (bots.length !== wanted.length) throw new ORPCError("FORBIDDEN");
      await prisma.$transaction(async (tx) => {
        await tx.botMailbox.deleteMany({ where: { mailboxId: row.id, botId: { notIn: wanted } } });
        await tx.botMailbox.createMany({
          data: wanted.map((botId) => ({ spaceId: scope.spaceId, mailboxId: row.id, botId })),
          skipDuplicates: true,
        });
      });
      return toDto(await load(scope, id));
    },
  };
}
