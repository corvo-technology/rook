import { randomUUID } from "node:crypto";
import type {
  AgentRunModel,
  AgentRuntime,
  AgentRuntimeEvent,
  ArtifactStore,
  ConnectorProvider,
  SecretStore,
} from "@corvo/adapter-kit";
import type { Actor, ConsultationTemplate } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  beginConsultationPurge,
  finishConsultationPurge,
  listConsultationChunks,
  listExpiredConsultations,
  recordSecurityEvent,
  recordUsage,
  runAsSystem,
  runAsTenant,
  setConsultationResult,
  settleConsultation,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import {
  type AudioTranscriptionDeps,
  dbVoiceCredential,
  transcribeAudioBytes,
} from "./audio-transcription.js";
import {
  type ConsultationRecord,
  type ConsultationStore,
  CreditsExhaustedError,
  processConsultation,
} from "./consultation-job.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import type { HostedVoice } from "./voice-credits.js";
import { creditVoiceKey } from "./voice-credits.js";

type Scope = { userId: string; spaceId: string };

export interface ConsultationWiringDeps {
  prisma: PrismaClient;
  artifacts: Pick<ArtifactStore, "get" | "put" | "remove">;
  runtime: AgentRuntime;
  secretStore: Pick<SecretStore, "load">;
  /** The tenant's models: the strong tier for the note, the fast tier for speaker labels. */
  resolveModel(scope: Scope & { botId: string }): Promise<AgentRunModel>;
  resolveFastModel(scope: Scope): Promise<AgentRunModel | undefined>;
  resolveStrongModel(scope: Scope): Promise<AgentRunModel | undefined>;
  connector: Pick<ConnectorProvider, "execute">;
  deploymentModelKey?: string;
  allowPrivateEndpoint?: boolean;
  /** The deployment's speech key for customers on credits. */
  voiceCredits?: HostedVoice;
  /** Replaces the speech provider factory; for tests. */
  createVoiceProvider?: AudioTranscriptionDeps["createProvider"];
}

const MODEL_TIMEOUT_MS = 120_000;
const TOOL_TIMEOUT_MS = 90_000;
const FAILED = /^(?:I hit a problem:|Unknown model )/i;
const NO_CREDITS = /Not enough model credits/i;

/** Where a customer's record tools live: the bot that holds the connector, and the server. */
async function findConnectorTarget(
  prisma: PrismaClient,
  record: Pick<ConsultationRecord, "spaceId" | "partnerId">,
): Promise<{ botId: string; serverId: string } | null> {
  const where = { spaceId: record.spaceId, server: { enabled: true } };
  // The Escriba the partner's template made, else any agent that holds the connector.
  const assignment =
    (await prisma.botMcpServer.findFirst({
      where: { ...where, bot: { spawnKey: `partner:${record.partnerId}:escriba` } },
      select: { botId: true, serverId: true },
    })) ??
    (await prisma.botMcpServer.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { botId: true, serverId: true },
    }));
  return assignment;
}

function prismaStore(prisma: PrismaClient): ConsultationStore {
  return {
    async load(id) {
      const row = await prisma.consultation.findUnique({
        where: { id },
        include: { tenant: { select: { organizationId: true, ownerUserId: true } } },
      });
      if (!row) return null;
      return {
        id: row.id,
        partnerId: row.partnerId,
        tenantId: row.tenantId,
        spaceId: row.tenant.organizationId,
        ownerUserId: row.tenant.ownerUserId,
        state: row.state,
        template: row.template as ConsultationTemplate,
        context: row.context as unknown as ConsultationRecord["context"],
        createdAt: row.createdAt,
        resultArtifactId: row.resultArtifactId,
        purgedAt: row.purgedAt,
      };
    },
    chunks: (id) => listConsultationChunks(prisma, id),
    setResult: (id, artifactId) => setConsultationResult(prisma, id, artifactId),
    settle: (id, outcome) => settleConsultation(prisma, id, outcome),
  };
}

/** The job: runs as the system for the consultation rows and as the customer for everything else. */
export function createConsultationProcessor(deps: ConsultationWiringDeps) {
  const targets = new Map<string, { botId: string; serverId: string } | null>();
  const target = async (record: ConsultationRecord) => {
    if (!targets.has(record.id)) {
      targets.set(
        record.id,
        await runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, () =>
          findConnectorTarget(deps.prisma, record),
        ),
      );
    }
    return targets.get(record.id) ?? null;
  };
  // Customers on credits are charged for transcription from the deployment's speech key.
  const voiceCredits =
    deps.voiceCredits ??
    creditVoiceKey({
      creditsEnabled: true,
      provider: resolveDeploymentModel().provider,
      key: deps.deploymentModelKey,
    });
  const transcription: AudioTranscriptionDeps = {
    prisma: deps.prisma,
    // Audio is read from the consultation's own sealed chunks, never from the artifact table.
    artifacts: { get: () => Promise.reject(new Error("not used")) },
    loadVoiceCredential: dbVoiceCredential(deps.prisma, deps.secretStore),
    // The partner asserted the patient's consent when it opened the consultation.
    hasConsent: async () => true,
    ...(voiceCredits ? { voiceCredits } : {}),
    ...(deps.createVoiceProvider ? { createProvider: deps.createVoiceProvider } : {}),
    ...(deps.allowPrivateEndpoint === undefined
      ? {}
      : { allowPrivateEndpoint: deps.allowPrivateEndpoint }),
  };

  return async (consultationId: string): Promise<void> => {
    await runAsSystem("process a consultation", () =>
      processConsultation(
        {
          store: prismaStore(deps.prisma),
          artifacts: deps.artifacts,
          transcribe: (record, input) =>
            runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, () =>
              transcribeAudioBytes(transcription, {
                actor: { spaceId: record.spaceId, userId: record.ownerUserId } as Actor,
                audio: input.audio,
                mimeType: input.mimeType,
                language: "pt",
              }),
            ),
          complete: (record, call) =>
            runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, async () => {
              const found = await target(record);
              if (!found) throw new Error("No agent holds the record connector");
              return runModel(deps, record, found.botId, call);
            }),
          callTool: (record, tool, args) =>
            runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, async () => {
              const found = await target(record);
              if (!found) return { ok: false };
              const executionId = `consultation:${randomUUID()}`;
              for await (const event of deps.connector.execute(
                {
                  tool,
                  args,
                  executionId,
                  route: { connectorId: "mcp", toolName: tool, resourceId: found.serverId },
                },
                {
                  operationId: executionId,
                  traceId: executionId,
                  spaceId: record.spaceId,
                  userId: record.ownerUserId,
                  botId: found.botId,
                  signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
                },
              )) {
                if (event.type === "result") return { ok: true, data: event.data };
                if (event.type === "error") return { ok: false, message: event.message };
              }
              return { ok: false };
            }),
          audit: ({ type, consultationId: id, outcome }) =>
            void recordSecurityEvent({ type, metadata: { consultationId: id, outcome } }),
        },
        consultationId,
      ),
    );
  };
}

async function runModel(
  deps: ConsultationWiringDeps,
  record: ConsultationRecord,
  botId: string,
  call: { tier: "fast" | "strong"; operation: string; instructions: string; prompt: string },
): Promise<string | undefined> {
  const scope = { userId: record.ownerUserId, spaceId: record.spaceId };
  const tiered =
    call.tier === "strong"
      ? await deps.resolveStrongModel(scope)
      : await deps.resolveFastModel(scope);
  const model = tiered ?? (await deps.resolveModel({ ...scope, botId }));
  // "scripted" means no model is configured; it would answer with canned text.
  if (model.provider === "scripted") throw new Error("No model is configured");
  const operationId = `${call.operation}:${randomUUID()}`;
  const usage = { ...scope, botId, operationId, operationKind: "setup" } as const;
  const record_ = async (event: Extract<AgentRuntimeEvent, { type: "usage" }>) => {
    await recordUsage(deps.prisma, event, usage);
  };
  let text = "";
  for await (const event of deps.runtime.run(
    {
      botId,
      threadId: operationId,
      runId: operationId,
      usageOperationKind: "setup",
      onUsage: record_,
      prompt: call.prompt,
      instructions: call.instructions,
      history: [],
      tools: [],
      model,
    },
    {
      operationId,
      traceId: operationId,
      ...scope,
      botId,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    },
  )) {
    if (event.type === "usage" && !event.accounted) await record_(event);
    if (event.type === "done" && event.text) text = event.text;
  }
  if (NO_CREDITS.test(text)) throw new CreditsExhaustedError();
  if (FAILED.test(text.trim())) throw new Error("The model could not answer");
  return text;
}

/**
 * Deletes the audio, transcript and note of consultations whose retention has run out, and fails
 * the ones stuck in processing for too long. Only the kind of event is audited, never content.
 */
export function createConsultationRetentionSweeper(deps: {
  prisma: PrismaClient;
  artifacts: Pick<ArtifactStore, "remove">;
  now?: () => Date;
  intervalMs?: number;
}): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? 10 * 60_000;
  let lastRun: number | undefined;
  return async () => {
    const now = (deps.now ?? (() => new Date()))();
    if (lastRun !== undefined && now.getTime() - lastRun < intervalMs) return;
    lastRun = now.getTime();
    await runAsSystem("delete consultation recordings past their retention", async () => {
      const stale = new Date(now.getTime() - STUCK_AFTER_MS);
      await deps.prisma.consultation.updateMany({
        where: { state: "processing", finishedAt: { lt: stale }, purgedAt: null },
        data: { state: "failed", errorCode: "internal" },
      });
      const expired = await listExpiredConsultations(deps.prisma, now);
      for (const { id } of expired) {
        try {
          await deleteConsultationContent(deps, id, "consultation.expired", now);
        } catch (error) {
          getLogger().warn("consultation retention failed", {
            "consultation.id": id,
            "error.type": error instanceof Error ? error.name : "unknown",
          });
        }
      }
    });
  };
}

const STUCK_AFTER_MS = 60 * 60_000;

/**
 * Deletes a consultation's sealed objects, then the references to them. If an object cannot be
 * deleted the references stay, and the next sweep tries again. True when the content is gone.
 */
export async function deleteConsultationContent(
  deps: { prisma: PrismaClient; artifacts: Pick<ArtifactStore, "remove"> },
  consultationId: string,
  /** The event to audit, or null when the caller audits the deletion itself. */
  event: "consultation.expired" | null,
  now = new Date(),
): Promise<boolean> {
  const purge = await beginConsultationPurge(deps.prisma, consultationId, now);
  if (!purge) return false;
  for (const artifactId of purge.artifactIds) {
    await deps.artifacts.remove(artifactId, {
      operationId: "consultation-delete",
      traceId: "consultation-delete",
      spaceId: purge.spaceId,
      userId: "",
      signal: AbortSignal.timeout(30_000),
    });
  }
  await finishConsultationPurge(deps.prisma, consultationId);
  if (purge.firstTime && event) {
    await recordSecurityEvent({
      type: event,
      spaceId: purge.spaceId,
      metadata: { consultationId, objects: purge.artifactIds.length },
    });
  }
  return true;
}
