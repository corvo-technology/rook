import { createHash } from "node:crypto";
import type { ComputerMode, PlanId } from "@corvo/contracts";
import { planConfigFromEnv } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { organizationEntitlements, organizationIdOfSpace } from "./plans.js";
import { runAsSystem, runAsSystemInTransaction } from "./row-security.js";
import { withTransactionRetry } from "./transaction-retry.js";

export type { ComputerMode } from "@corvo/contracts";

export function parseComputerMode(scope: string): ComputerMode {
  if (scope === "team" || scope === "dedicated") return scope;
  throw new Error(`Unknown computer scope: ${scope}`);
}

export type ComputerKeyInput = {
  mode: ComputerMode;
  spaceId: string;
  /** The bot owner's user id. A team computer is shared only by one user's bots in a space. */
  userId: string;
  botId?: string;
};

export function computerScopeKey(input: ComputerKeyInput) {
  if (input.mode === "team") return `team:${input.spaceId}:${input.userId}`;
  if (!input.botId) throw new Error("Dedicated computers require a bot id");
  return `bot:${input.botId}`;
}

/**
 * Sandbox providers receive the home key as the computer's bot id, and the Docker supervisor
 * keeps only its first 40 characters in container names, so a team key is a fixed-length
 * digest that stays distinct per space and user. Migration 20261021000000 computes the same
 * value in SQL. Team computers created before the per-user split keep `team-<spaceId>`.
 */
export function computerHomeKey(input: ComputerKeyInput) {
  if (input.mode === "team") {
    const digest = createHash("sha256")
      .update(`${input.spaceId}:${input.userId}`)
      .digest("hex")
      .slice(0, 32);
    return `team-${digest}`;
  }
  if (!input.botId) throw new Error("Dedicated computers require a bot id");
  return input.botId;
}

/** The home of a space's one Team Computer from before each person got their own. */
export function legacyTeamHomeKey(spaceId: string) {
  return `team-${spaceId}`;
}

type ComputerDb = Pick<PrismaClient, "computer">;
type ComputerTx = Pick<Prisma.TransactionClient, "computer" | "$queryRaw">;
type ComputerClient = ComputerDb & Partial<Pick<PrismaClient, "$transaction" | "$queryRaw">>;
type RestoreTx = ComputerTx & Pick<Prisma.TransactionClient, "bot">;
type RestoreClient = ComputerClient & Pick<PrismaClient, "bot">;
type ExecutionLeaseDb = Pick<PrismaClient, "computerExecutionLease">;

/**
 * Per-user ceiling on Computer records that still back a live bot, or 0 when unset.
 *
 * Each Computer row becomes a sandbox container once provisioned, so an unbounded
 * record count means an unbounded container fleet for one user. A team computer is
 * one row per space and user, shared by that user's bots there, and counts once, not per bot.
 */
export function resolveMaxComputersPerUser(
  value = process.env.SANDBOX_MAX_COMPUTERS_PER_USER,
): number {
  if (value === undefined || value.trim() === "" || value.trim() === "0") return 0;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(
      "SANDBOX_MAX_COMPUTERS_PER_USER must be a positive integer, or 0 for no configured cap",
    );
  }
  return limit;
}

/**
 * Thrown when creating or restoring a computer would pass the cap. `plan` is set when the cap is
 * the organization's plan, which is the case where an upgrade helps.
 */
export class ComputerLimitError extends Error {
  readonly plan?: PlanId;
  constructor(
    readonly limit: number,
    plan?: PlanId,
  ) {
    super(
      plan
        ? "Your plan has no room for another computer"
        : `User computer limit (${limit}) reached`,
    );
    this.name = "ComputerLimitError";
    this.plan = plan;
  }
}

/**
 * The one cap that applies to a new computer. Where the deployment configures plans, the
 * organization's plan decides how many computers it may have; `SANDBOX_MAX_COMPUTERS_PER_USER`
 * is then not consulted. Without plans, that variable stays the per-person cap, or none.
 */
export type ComputerQuota =
  | { scope: "user"; limit: number }
  | { scope: "organization"; limit: number; organizationId: string; plan: PlanId };

type QuotaDb = Pick<PrismaClient, "space" | "billingAccount" | "organizationLimitOverride">;

export async function resolveComputerQuota(
  prisma: QuotaDb,
  spaceId: string,
): Promise<ComputerQuota | null> {
  const config = planConfigFromEnv();
  if (config) {
    const organizationId = await organizationIdOfSpace(prisma, spaceId);
    const plan = organizationId
      ? await organizationEntitlements(prisma, config, organizationId)
      : null;
    if (organizationId && plan)
      return { scope: "organization", limit: plan.computers, organizationId, plan: plan.plan };
  }
  const limit = resolveMaxComputersPerUser();
  return limit > 0 ? { scope: "user", limit } : null;
}

/** Computers an organization has that still back a live bot, across its spaces. */
export async function organizationComputerCount(
  prisma: ComputerDb,
  organizationId: string,
): Promise<number> {
  return runAsSystem("organization computer count for plan usage", () =>
    prisma.computer.count({
      where: { space: { organizationId }, bots: { some: { archivedAt: null } } },
    }),
  );
}

function quotaError(quota: ComputerQuota) {
  return new ComputerLimitError(
    quota.limit,
    quota.scope === "organization" ? quota.plan : undefined,
  );
}

/**
 * Computers a user still backs with a live (non-archived) bot.
 *
 * excludeBotId drops one bot's current reference: a bot being re-linked to a
 * new computer in the same transaction leaves its old row behind, so that
 * intermediate reference must not count against the final live set.
 */
async function countInUseComputers(
  prisma: ComputerDb & Partial<Pick<PrismaClient, "$queryRaw">>,
  quota: ComputerQuota,
  userId: string,
  excludeBotId?: string,
): Promise<number> {
  const count = () =>
    prisma.computer.count({
      where: {
        ...(quota.scope === "organization"
          ? { space: { organizationId: quota.organizationId } }
          : { userId }),
        bots: {
          some: excludeBotId
            ? { archivedAt: null, id: { not: excludeBotId } }
            : { archivedAt: null },
        },
      },
    });
  // The quota spans Spaces: a person's, or the organization's under a plan.
  const reason = "computer quota across Spaces";
  return prisma.$queryRaw
    ? runAsSystemInTransaction(prisma as Pick<PrismaClient, "$queryRaw">, reason, count)
    : runAsSystem(reason, count);
}

/**
 * Serialize existence check + in-use count + Computer create for one user.
 * Seed 1 keeps this keyspace apart from lockSpaceForContentCreation (seed 0).
 */
async function lockForComputerQuota(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  quota: ComputerQuota,
  userId: string,
): Promise<void> {
  const key = quota.scope === "organization" ? `org:${quota.organizationId}` : userId;
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 1))::text AS "lock"
  `);
}

/**
 * Refuse a restore that would push a user past the cap.
 *
 * A restore re-links the bot to its Computer row, which reactivates the quota
 * if that row was only referenced by archived bots (the dedicated case; a team
 * row shared with live bots keeps counting). Throws ComputerLimitError when the
 * restore would exceed the configured SANDBOX_MAX_COMPUTERS_PER_USER.
 */
export async function assertComputerQuotaForRestore(
  prisma: ComputerDb,
  input: { userId: string; computerId: string },
  known?: ComputerQuota | null,
): Promise<void> {
  const quota = known ?? (await quotaOfComputer(prisma, input.computerId));
  if (!quota) return;
  // If another live bot already references this row (a team computer shared
  // by the user's bots in the space), restoring this bot adds nothing to the count.
  const alreadyLive = await prisma.computer.count({
    where: {
      id: input.computerId,
      bots: { some: { archivedAt: null } },
    },
  });
  if (alreadyLive > 0) return;
  const inUse = await countInUseComputers(prisma, quota, input.userId);
  if (inUse >= quota.limit) throw quotaError(quota);
}

async function quotaOfComputer(prisma: ComputerDb, computerId: string) {
  // Without plans the cap never needs the computer's space.
  if (!planConfigFromEnv()) return resolveComputerQuota(prisma as unknown as QuotaDb, "");
  const computer = await prisma.computer.findUnique({
    where: { id: computerId },
    select: { spaceId: true },
  });
  return computer ? resolveComputerQuota(prisma as unknown as QuotaDb, computer.spaceId) : null;
}

/**
 * Unarchive a bot while holding the same per-user quota lock as create.
 *
 * Concurrent restores of archived bots on distinct computers can both pass an
 * unlocked count when one slot remains; the lock covers count + archivedAt
 * clear so only one of those restores can consume the last slot.
 */
export async function restoreBotUnderComputerQuota(
  prisma: RestoreClient,
  input: { userId: string; botId: string; computerId: string },
): Promise<void> {
  const quota = await quotaOfComputer(prisma, input.computerId);

  async function restore(tx: RestoreTx) {
    if (quota) {
      await lockForComputerQuota(tx, quota, input.userId);
      await assertComputerQuotaForRestore(tx, input, quota);
    }
    await tx.bot.update({ where: { id: input.botId }, data: { archivedAt: null } });
  }

  if (isTransactionClient(prisma)) {
    return restore(prisma as RestoreTx);
  }
  if (!quota) {
    await prisma.bot.update({ where: { id: input.botId }, data: { archivedAt: null } });
    return;
  }
  if (typeof prisma.$transaction === "function") {
    return withTransactionRetry(() => prisma.$transaction!((tx) => restore(tx)));
  }
  throw new Error("Computer quota enforcement requires a Prisma transaction");
}

/** Expire leases as fencing tombstones so the next acquire increments fence. */
export async function expireComputerExecutionLeases(
  prisma: ExecutionLeaseDb,
  where: Prisma.ComputerExecutionLeaseWhereInput,
): Promise<void> {
  await prisma.computerExecutionLease.updateMany({
    where,
    data: { expiresAt: new Date(0) },
  });
}

function upsertComputerRecord(
  prisma: ComputerDb,
  input: {
    mode: ComputerMode;
    spaceId: string;
    userId: string;
    botId?: string;
    kind: string;
  },
  scopeKey: string,
) {
  return prisma.computer.upsert({
    where: { scopeKey },
    create: {
      spaceId: input.spaceId,
      userId: input.userId,
      scope: input.mode,
      scopeKey,
      homeKey: computerHomeKey(input),
      kind: input.kind,
    },
    update: {},
  });
}

async function ensureComputerRecordWithQuota(
  tx: ComputerTx,
  input: {
    mode: ComputerMode;
    spaceId: string;
    userId: string;
    botId?: string;
    kind: string;
  },
  quota: ComputerQuota,
  scopeKey: string,
) {
  await lockForComputerQuota(tx, quota, input.userId);
  // Only a new row consumes quota: the upsert below reuses the user's team
  // computer on every bot they create in that space, and reusing it with the count
  // already at the cap would wrongly refuse a second bot on a shared computer.
  const existing = await tx.computer.findUnique({
    where: { scopeKey },
    select: { id: true },
  });
  if (!existing) {
    // The bot being linked to this new computer is part of this same
    // transaction; its old or intermediate reference is leaving the live set
    // when this link commits. Exclude this bot's current reference so a
    // transaction that ends with exactly one active computer is not refused
    // at cap 1 (createBot links the team computer first, then re-links the
    // bot to the new dedicated one; setBotComputer switches the same way).
    // References from other active bots still count: a team computer another
    // live bot keeps using stays in-use after the re-link.
    const inUse = await countInUseComputers(tx, quota, input.userId, input.botId);
    // The new row itself will be referenced by this bot after the link, so
    // the post-transaction set is one more than the remaining live set.
    if (inUse + 1 > quota.limit) throw quotaError(quota);
  }
  return upsertComputerRecord(tx, input, scopeKey);
}

function isTransactionClient(prisma: ComputerClient): prisma is ComputerTx {
  return typeof prisma.$queryRaw === "function" && typeof prisma.$transaction !== "function";
}

export async function ensureComputerRecord(
  prisma: ComputerClient,
  input: {
    mode: ComputerMode;
    spaceId: string;
    userId: string;
    botId?: string;
    kind: string;
  },
) {
  const scopeKey = computerScopeKey(input);
  const quota = await resolveComputerQuota(prisma as unknown as QuotaDb, input.spaceId);
  if (!quota) return upsertComputerRecord(prisma, input, scopeKey);

  // A cap applies: hold an advisory lock across find + count + create so concurrent creates
  // for different spaces cannot both pass the check.
  if (isTransactionClient(prisma)) {
    return ensureComputerRecordWithQuota(prisma, input, quota, scopeKey);
  }
  if (typeof prisma.$transaction === "function") {
    return withTransactionRetry(() =>
      prisma.$transaction!((tx) => ensureComputerRecordWithQuota(tx, input, quota, scopeKey)),
    );
  }
  throw new Error("Computer quota enforcement requires a Prisma transaction");
}
