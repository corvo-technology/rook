import type { ArtifactStore, JobPublisher } from "@corvo/adapter-kit";
import { consultationProcessJob } from "@corvo/adapter-kit";
import { deleteConsultationContent, readConsultationResult } from "@corvo/adapters";
import { CONSULTATION_MAX_CHUNKS, CONSULTATION_MAX_TOTAL_BYTES } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  addConsultationChunk,
  createConsultation,
  findConsultation,
  isPartnerTestOrganization,
  recordSecurityEvent,
  settleConsultation,
  spaceHasModelAccess,
  startConsultationProcessing,
} from "@corvo/db";
import type { PartnerConsultationDeps } from "./partner-consultations.js";

/** The parts of the app a recording call needs, composed from the database and sealed storage. */
export function partnerConsultationDeps(deps: {
  prisma: PrismaClient;
  artifacts: Pick<ArtifactStore, "get" | "put" | "remove">;
  jobs: Pick<JobPublisher, "enqueue">;
  base: Pick<PartnerConsultationDeps, "now" | "allowRequest" | "authenticate" | "findTenant">;
}): PartnerConsultationDeps {
  const { prisma, artifacts, jobs } = deps;
  const contextFor = (organizationId: string) => ({
    operationId: "consultation",
    traceId: "consultation",
    spaceId: organizationId,
    userId: "",
    signal: AbortSignal.timeout(60_000),
  });
  return {
    ...deps.base,
    // A test customer needs no credit; its partner's daily cap is the limit.
    hasCredit: async (organizationId) =>
      (await isPartnerTestOrganization(prisma, organizationId)) ||
      spaceHasModelAccess(prisma, organizationId),
    create: async (input) => ({ id: (await createConsultation(prisma, input)).id }),
    find: async (scope) => {
      const row = await findConsultation(prisma, scope);
      if (!row) return null;
      const chunkCount = await prisma.consultationChunk.count({
        where: { consultationId: row.id },
      });
      return {
        id: row.id,
        state: row.state,
        draftEntryId: row.draftEntryId,
        errorCode: row.errorCode,
        chunkCount,
      };
    },
    storeChunk: async (consultation, chunk) => {
      const stored = await artifacts.put(
        { name: "consultation-chunk", mimeType: chunk.mimeType, bytes: chunk.bytes },
        contextFor(consultation.organizationId),
      );
      const outcome = await addConsultationChunk(
        prisma,
        consultation.id,
        {
          seq: chunk.seq,
          artifactId: stored.id,
          size: chunk.bytes.byteLength,
          mimeType: chunk.mimeType,
        },
        { maxChunks: CONSULTATION_MAX_CHUNKS, maxBytes: CONSULTATION_MAX_TOTAL_BYTES },
      );
      // Nothing refers to the bytes of a repeat or a refused chunk, so they go at once.
      if (outcome !== "stored") {
        await artifacts
          .remove(stored.id, contextFor(consultation.organizationId))
          .catch(() => undefined);
      }
      return outcome;
    },
    finish: async (consultationId) => {
      if (!(await startConsultationProcessing(prisma, consultationId))) return false;
      try {
        await jobs.enqueue(consultationProcessJob(consultationId));
      } catch (error) {
        await settleConsultation(prisma, consultationId, {
          state: "failed",
          errorCode: "internal",
        });
        throw error;
      }
      return true;
    },
    result: async (consultation) => {
      const row = await prisma.consultation.findUnique({
        where: { id: consultation.id },
        select: { resultArtifactId: true },
      });
      if (!row?.resultArtifactId) return null;
      const result = await readConsultationResult(
        { artifacts },
        {
          spaceId: consultation.organizationId,
          ownerUserId: "",
          resultArtifactId: row.resultArtifactId,
        },
      );
      return result ? { turns: result.turns, ...(result.note ? { note: result.note } : {}) } : null;
    },
    remove: async (consultationId) => {
      await deleteConsultationContent({ prisma, artifacts }, consultationId, null);
    },
    audit: ({ type, consultationId, partnerId, organizationId, action }) =>
      void recordSecurityEvent({
        type,
        spaceId: organizationId,
        metadata: { consultationId, partnerId, action },
      }),
  };
}
