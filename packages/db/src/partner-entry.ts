import type { PrismaClient } from "./client.js";

/** Who a spent entry code opens, as the partner described them in the session call. */
export interface PartnerEntry {
  /** The customer's owner, whom every session opened before roles existed. */
  userId: string;
  tenantId: string;
  partnerId: string;
  organizationId: string;
  externalUserId: string;
  externalEmail: string | null;
  /** The role the partner sent; null means owner. */
  role: string | null;
  scope: Record<string, unknown> | null;
}

/**
 * Spends an entry code and returns who it opens, or null. One conditional update both checks and
 * spends, so of any number of racing requests exactly one gets the person. A code that is
 * unknown, spent, expired, or whose customer or partner has been switched off since it was made
 * all answer the same. Call with a client that runs as the system.
 */
export async function consumePartnerEntryCode(
  prisma: PrismaClient,
  codeHash: string,
  now = new Date(),
): Promise<PartnerEntry | null> {
  const rows = await prisma.$queryRaw<PartnerEntry[]>`
    UPDATE "partner_entry_codes" AS code
    SET "usedAt" = ${now}
    FROM "partner_tenants" AS tenant, "partners" AS partner
    WHERE code."codeHash" = ${codeHash}
      AND code."usedAt" IS NULL
      AND code."expiresAt" > ${now}
      AND tenant."id" = code."tenantId"
      AND tenant."state" = 'enabled'
      AND partner."id" = tenant."partnerId"
      AND partner."enabled"
    RETURNING tenant."ownerUserId" AS "userId", tenant."id" AS "tenantId",
      tenant."partnerId" AS "partnerId", tenant."organizationId" AS "organizationId",
      code."externalUserId" AS "externalUserId", code."externalEmail" AS "externalEmail",
      code."role" AS "role", code."scope" AS "scope"`;
  return rows[0] ?? null;
}
