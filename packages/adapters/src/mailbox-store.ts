import type { AdapterContext, SecretStore } from "@corvo/adapter-kit";
import type { MailboxConfig } from "@corvo/contracts";
import { MailboxConfigSchema } from "@corvo/contracts";
import { storedAccessLevel } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";

export interface StoredMailbox {
  id: string;
  spaceId: string;
  userId: string;
  address: string;
  config: MailboxConfig;
  secretId: string | null;
  /** What the asking agent may do with it: read, or write (draft and send). */
  level: "read" | "write";
}

export type SendClaim = "claimed" | "already_sent" | "in_doubt" | "throttled";

/** What the mailbox tools need from storage. Postgres in production, memory in tests. */
export interface MailboxStore {
  /** Mailboxes this agent was given, owned by the agent's owner. */
  granted(scope: { spaceId: string; userId: string; botId: string }): Promise<StoredMailbox[]>;
  password(mailbox: StoredMailbox, context: AdapterContext): Promise<string>;
  /** Reserves one send for this execution, or says why it must not go out. */
  claimSend(input: {
    mailbox: StoredMailbox;
    botId: string;
    executionId: string;
    limitPerHour: number;
  }): Promise<SendClaim>;
  /** `sent` once the server took the message; `released` when it provably did not. */
  settleSend(
    mailbox: StoredMailbox,
    executionId: string,
    outcome: "sent" | "released",
  ): Promise<void>;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

export class PrismaMailboxStore implements MailboxStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secrets: SecretStore,
  ) {}

  async granted(scope: {
    spaceId: string;
    userId: string;
    botId: string;
  }): Promise<StoredMailbox[]> {
    const rows = await this.prisma.mailbox.findMany({
      where: {
        spaceId: scope.spaceId,
        userId: scope.userId,
        grants: { some: { botId: scope.botId, spaceId: scope.spaceId } },
      },
      orderBy: { createdAt: "asc" },
      include: { grants: { where: { botId: scope.botId }, select: { level: true } } },
    });
    return rows.flatMap((row) => {
      const config = MailboxConfigSchema.safeParse(row.config);
      return config.success
        ? [
            {
              id: row.id,
              spaceId: row.spaceId,
              userId: row.userId,
              address: row.address,
              config: config.data,
              secretId: row.secretId,
              level: storedAccessLevel(row.grants[0]?.level),
            },
          ]
        : [];
    });
  }

  async password(mailbox: StoredMailbox, context: AdapterContext): Promise<string> {
    const row = mailbox.secretId
      ? await this.prisma.secret.findFirst({
          where: { id: mailbox.secretId, spaceId: context.spaceId, userId: context.userId },
        })
      : null;
    if (!row) throw new Error("This mailbox has no saved password");
    return this.secrets.load(row.ciphertext, row.id);
  }

  async claimSend(input: {
    mailbox: StoredMailbox;
    botId: string;
    executionId: string;
    limitPerHour: number;
  }): Promise<SendClaim> {
    const { mailbox, botId, executionId } = input;
    const recent = await this.prisma.mailboxSend.count({
      where: {
        mailboxId: mailbox.id,
        botId,
        executionId: { not: executionId },
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
      },
    });
    if (recent >= input.limitPerHour) return "throttled";
    try {
      await this.prisma.mailboxSend.create({
        data: { spaceId: mailbox.spaceId, mailboxId: mailbox.id, botId, executionId },
      });
      return "claimed";
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.mailboxSend.findUnique({
        where: { mailboxId_executionId: { mailboxId: mailbox.id, executionId } },
      });
      return existing?.status === "sent" ? "already_sent" : "in_doubt";
    }
  }

  async settleSend(
    mailbox: StoredMailbox,
    executionId: string,
    outcome: "sent" | "released",
  ): Promise<void> {
    const where = { mailboxId_executionId: { mailboxId: mailbox.id, executionId } };
    if (outcome === "sent")
      await this.prisma.mailboxSend.update({ where, data: { status: "sent" } });
    else await this.prisma.mailboxSend.delete({ where }).catch(() => undefined);
  }
}
