import type { ConsultationErrorCode, ConsultationState } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import type { Consultation, ConsultationChunk } from "./generated/prisma/client.js";

/** Consultation rows are health data: call these with a client that runs as the system. */
export type ConsultationRow = Consultation;
export type ConsultationChunkRow = ConsultationChunk;

export async function createConsultation(
  prisma: PrismaClient,
  input: {
    partnerId: string;
    tenantId: string;
    externalUserId: string;
    template: string;
    context: object;
    consent: object;
    retentionDays: number;
  },
): Promise<ConsultationRow> {
  return prisma.consultation.create({ data: input });
}

/** Only a consultation of this partner's customer, and never one whose content was deleted. */
export async function findConsultation(
  prisma: PrismaClient,
  scope: { partnerId: string; tenantId: string; id: string },
): Promise<ConsultationRow | null> {
  return prisma.consultation.findFirst({
    where: {
      id: scope.id,
      partnerId: scope.partnerId,
      tenantId: scope.tenantId,
      purgedAt: null,
    },
  });
}

export async function listConsultationChunks(
  prisma: PrismaClient,
  consultationId: string,
): Promise<ConsultationChunkRow[]> {
  return prisma.consultationChunk.findMany({
    where: { consultationId },
    orderBy: { seq: "asc" },
  });
}

export type AddChunkOutcome = "stored" | "duplicate" | "too_many" | "too_large" | "closed";

/**
 * Records one uploaded piece. A seq that already exists is a repeat and changes nothing, so a
 * retry is safe. The count and total size are checked under a lock, so uploads arriving together
 * cannot go past the caps.
 */
export async function addConsultationChunk(
  prisma: PrismaClient,
  consultationId: string,
  chunk: { seq: number; artifactId: string; size: number; mimeType: string },
  limits: { maxChunks: number; maxBytes: number },
): Promise<AddChunkOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consultation:${consultationId}`}, 0))`;
    const row = await tx.consultation.findUnique({
      where: { id: consultationId },
      select: { state: true, purgedAt: true },
    });
    if (row?.state !== "recording" || row.purgedAt) return "closed";
    const existing = await tx.consultationChunk.findUnique({
      where: { consultationId_seq: { consultationId, seq: chunk.seq } },
      select: { seq: true },
    });
    if (existing) return "duplicate";
    if (chunk.seq >= limits.maxChunks) return "too_many";
    const total = await tx.consultationChunk.aggregate({
      where: { consultationId },
      _sum: { size: true },
    });
    if ((total._sum.size ?? 0) + chunk.size > limits.maxBytes) return "too_large";
    await tx.consultationChunk.create({ data: { consultationId, ...chunk } });
    return "stored";
  });
}

/**
 * Moves a recording, or a failed consultation to be reprocessed from its stored chunks, to
 * processing once; false when it was in neither state.
 */
export async function startConsultationProcessing(
  prisma: PrismaClient,
  consultationId: string,
  now = new Date(),
): Promise<boolean> {
  const { count } = await prisma.consultation.updateMany({
    where: { id: consultationId, state: { in: ["recording", "failed"] }, purgedAt: null },
    data: { state: "processing", finishedAt: now, errorCode: null },
  });
  return count === 1;
}

export async function settleConsultation(
  prisma: PrismaClient,
  consultationId: string,
  outcome:
    | { state: "drafted"; draftEntryId: string; resultArtifactId: string }
    | { state: "failed"; errorCode: ConsultationErrorCode },
): Promise<boolean> {
  const data =
    outcome.state === "drafted"
      ? {
          state: "drafted" as const,
          draftEntryId: outcome.draftEntryId,
          resultArtifactId: outcome.resultArtifactId,
          errorCode: null,
        }
      : { state: "failed" as const, errorCode: outcome.errorCode };
  const { count } = await prisma.consultation.updateMany({
    where: { id: consultationId, state: "processing", purgedAt: null },
    data,
  });
  return count === 1;
}

/** Keeps the result of a finished step so a retry does not pay for it twice. */
export async function setConsultationResult(
  prisma: PrismaClient,
  consultationId: string,
  resultArtifactId: string,
): Promise<boolean> {
  const { count } = await prisma.consultation.updateMany({
    where: { id: consultationId, purgedAt: null },
    data: { resultArtifactId },
  });
  return count === 1;
}

export const consultationState = (row: Pick<Consultation, "state">): ConsultationState =>
  row.state as ConsultationState;

/**
 * First half of deleting a consultation: the content is no longer reachable (new uploads and
 * results are refused, reads answer not found) and the client's name, the professional's name and
 * the consent wording are removed from the row, which stays as a bare audit record. Returns the
 * sealed objects the caller must now delete from storage; once they are gone, call
 * {@link finishConsultationPurge}. Safe to repeat, so a failed deletion is retried.
 */
export async function beginConsultationPurge(
  prisma: PrismaClient,
  consultationId: string,
  now = new Date(),
): Promise<{ artifactIds: string[]; spaceId: string; firstTime: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`consultation:${consultationId}`}, 0))`;
    const row = await tx.consultation.findUnique({
      where: { id: consultationId },
      include: {
        chunks: { select: { artifactId: true } },
        tenant: { select: { organizationId: true } },
      },
    });
    if (!row) return null;
    if (!row.purgedAt) {
      const context = (row.context ?? {}) as { clientId?: string; appointmentId?: string };
      const consent = (row.consent ?? {}) as { obtained?: boolean; at?: string; method?: string };
      await tx.consultation.update({
        where: { id: consultationId },
        data: {
          purgedAt: now,
          context: {
            ...(context.clientId ? { clientId: context.clientId } : {}),
            ...(context.appointmentId ? { appointmentId: context.appointmentId } : {}),
          },
          consent: {
            ...(consent.obtained !== undefined ? { obtained: consent.obtained } : {}),
            ...(consent.at ? { at: consent.at } : {}),
            ...(consent.method ? { method: consent.method } : {}),
          },
        },
      });
    }
    return {
      artifactIds: [
        ...row.chunks.map((chunk) => chunk.artifactId),
        ...(row.resultArtifactId ? [row.resultArtifactId] : []),
      ],
      spaceId: row.tenant.organizationId,
      firstTime: !row.purgedAt,
    };
  });
}

/** Second half: the objects are deleted, so the references to them go too. */
export async function finishConsultationPurge(
  prisma: PrismaClient,
  consultationId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.consultationChunk.deleteMany({ where: { consultationId } });
    await tx.consultation.updateMany({
      where: { id: consultationId },
      data: { resultArtifactId: null },
    });
  });
}

/** A recording with no new chunk for this long was abandoned. */
export const ABANDONED_AFTER_MS = 2 * 60 * 60_000;

/**
 * Consultations whose retention has run out and whose content is still stored, and those whose
 * deletion began but did not finish, and recordings abandoned for two hours.
 */
export async function listExpiredConsultations(
  prisma: PrismaClient,
  now = new Date(),
  limit = 50,
): Promise<Array<{ id: string; partnerId: string; tenantId: string }>> {
  return prisma.$queryRaw<Array<{ id: string; partnerId: string; tenantId: string }>>`
    SELECT "id", "partnerId", "tenantId" FROM "consultations"
    WHERE ("purgedAt" IS NULL
        AND COALESCE("finishedAt", "createdAt") + ("retentionDays" * INTERVAL '1 day') < ${now})
      OR ("purgedAt" IS NULL AND "state" = 'recording'
        AND COALESCE(
          (SELECT MAX(c."createdAt") FROM "consultation_chunks" c WHERE c."consultationId" = "consultations"."id"),
          "createdAt") < ${new Date(now.getTime() - ABANDONED_AFTER_MS)})
      OR ("purgedAt" IS NOT NULL
        AND ("resultArtifactId" IS NOT NULL
          OR EXISTS (SELECT 1 FROM "consultation_chunks" c WHERE c."consultationId" = "consultations"."id")))
    ORDER BY "createdAt" ASC
    LIMIT ${limit}`;
}

export async function setPartnerScribeRetentionDays(
  prisma: PrismaClient,
  slug: string,
  days: number | null,
): Promise<void> {
  const result = await prisma.partner.updateMany({
    where: { slug },
    data: { scribeRetentionDays: days },
  });
  if (result.count === 0) throw new Error(`Unknown partner: ${slug}`);
}
