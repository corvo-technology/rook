import { randomUUID } from "node:crypto";
import type {
  AgentRunModel,
  AgentRuntime,
  AgentRuntimeEvent,
  ArtifactStore,
  ConnectorProvider,
  SecretStore,
} from "@corvo/adapter-kit";
import type {
  Actor,
  ConsultationAction,
  ConsultationActionsApplyInput,
  ConsultationTemplate,
} from "@corvo/contracts";
import {
  CONSULTATION_ACTION_PAYLOADS,
  CONSULTATION_STRUCTURED,
  ConsultationActionTools,
  isValidTimeZone,
} from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  beginConsultationPurge,
  CHIEF_SPAWN_KEY,
  claimConsultationAction,
  finishConsultationPurge,
  listConsultationActionRuns,
  listConsultationChunks,
  listExpiredConsultations,
  recordSecurityEvent,
  recordUsage,
  runAsSystem,
  runAsTenant,
  setConsultationResult,
  settleConsultation,
  settleConsultationAction,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import {
  type AudioTranscriptionDeps,
  dbVoiceCredential,
  transcribeAudioBytes,
} from "./audio-transcription.js";
import {
  applyActions,
  type ResolvedActionTools,
  resolveActionTools,
} from "./consultation-actions.js";
import {
  type ConsultationRecord,
  type ConsultationStore,
  CreditsExhaustedError,
  processConsultation,
  readConsultationResult,
} from "./consultation-job.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import { alertPartnerOfCause, alertPartnerOfSetupFailure } from "./partner-run-alerts.js";
import { classifyRunError } from "./run-error-code.js";
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
  connector: Pick<ConnectorProvider, "execute" | "discoverTools">;
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
        include: {
          tenant: {
            select: {
              organizationId: true,
              ownerUserId: true,
              owner: { select: { timezone: true } },
            },
          },
          partner: { select: { template: true } },
        },
      });
      if (!row) return null;
      const template = (row.partner.template ?? {}) as {
        timezone?: unknown;
        consultationActions?: { tools?: unknown };
      };
      const context = row.context as unknown as ConsultationRecord["context"] & {
        timezone?: string;
      };
      const timezone = [context.timezone, row.tenant.owner.timezone, template.timezone].find(
        (zone): zone is string => typeof zone === "string" && isValidTimeZone(zone),
      );
      const override = ConsultationActionTools.safeParse(template.consultationActions?.tools);
      return {
        id: row.id,
        partnerId: row.partnerId,
        tenantId: row.tenantId,
        spaceId: row.tenant.organizationId,
        ownerUserId: row.tenant.ownerUserId,
        state: row.state,
        template: row.template as ConsultationTemplate | typeof CONSULTATION_STRUCTURED,
        context,
        createdAt: row.createdAt,
        resultArtifactId: row.resultArtifactId,
        purgedAt: row.purgedAt,
        ...(timezone ? { timezone } : {}),
        ...(override.success ? { actionToolOverride: override.data } : {}),
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
              if (found) return runModel(deps, record, found.botId, call);
              // A structured recording needs no record connector: any agent of the customer, the
              // Chief first, lends its model routing and its name to the usage.
              const bot =
                record.template === CONSULTATION_STRUCTURED
                  ? ((await deps.prisma.bot.findFirst({
                      where: { spaceId: record.spaceId, spawnKey: CHIEF_SPAWN_KEY },
                      select: { id: true },
                    })) ??
                    (await deps.prisma.bot.findFirst({
                      where: { spaceId: record.spaceId },
                      orderBy: { createdAt: "asc" },
                      select: { id: true },
                    })))
                  : null;
              if (!bot) throw new Error("No agent holds the record connector");
              return runModel(deps, record, bot.id, call);
            }),
          callTool: (record, tool, args, options) =>
            runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, async () => {
              const found = await target(record);
              if (!found) return { ok: false };
              return callConnectorTool(deps, record, found, tool, args, options?.requestedByUserId);
            }),
          actionTools: (record) =>
            runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, async () => {
              const found = await target(record);
              return found ? discoverActionTools(deps, record, found) : {};
            }),
          onSetupFailure: (record, cause) => alertPartnerOfCause(deps, record.spaceId, cause),
          audit: ({ type, consultationId: id, outcome }) =>
            void recordSecurityEvent({ type, metadata: { consultationId: id, outcome } }),
        },
        consultationId,
      ),
    );
  };
}

type ConnectorTarget = { botId: string; serverId: string };

/** One tool call on the customer's connector, as the Escriba and, when given, as one person. */
async function callConnectorTool(
  deps: Pick<ConsultationWiringDeps, "connector">,
  record: ConsultationRecord,
  found: ConnectorTarget,
  tool: string,
  args: Record<string, unknown>,
  requestedByUserId?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; message?: string }> {
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
      ...(requestedByUserId ? { requestedByUserId } : {}),
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    },
  )) {
    if (event.type === "result") return { ok: true, data: event.data };
    if (event.type === "error") return { ok: false, message: event.message };
  }
  return { ok: false };
}

/**
 * The connector's tools for actions: the names the partner's template gives, else the ones its
 * tool list offers by name. A connector with too many tools lists only a catalog; then only the
 * template's names apply.
 */
async function discoverActionTools(
  deps: Pick<ConsultationWiringDeps, "connector">,
  record: ConsultationRecord,
  found: ConnectorTarget,
): Promise<ResolvedActionTools> {
  let offered: string[] = [];
  try {
    const id = `consultation:${randomUUID()}`;
    const tools = await deps.connector.discoverTools({
      operationId: id,
      traceId: id,
      spaceId: record.spaceId,
      userId: record.ownerUserId,
      botId: found.botId,
      signal: AbortSignal.timeout(30_000),
    });
    offered = tools
      .filter((tool) => tool.route?.resourceId === found.serverId)
      .map((tool) => tool.route?.toolName ?? tool.name);
  } catch {
    // The template's own names still apply.
  }
  return resolveActionTools(offered, record.actionToolOverride);
}

/**
 * Carries out the actions of a drafted consultation a person approved, through the customer's
 * connector, as that person. Each action runs once however many times it is asked for.
 */
export function createConsultationActionApplier(
  deps: Pick<ConsultationWiringDeps, "prisma" | "artifacts" | "connector">,
) {
  const store = prismaStore(deps.prisma);
  return async (
    consultationId: string,
    request: ConsultationActionsApplyInput,
    caller: { requestedByUserId?: string },
  ): Promise<
    | { ok: true; actions: ConsultationAction[] }
    | { ok: false; error: "not_found" | "unknown_action" | "invalid_edit" }
  > =>
    runAsSystem("apply the actions of a consultation", async () => {
      const record = await store.load(consultationId);
      if (!record || record.purgedAt || record.state !== "drafted") {
        return { ok: false, error: "not_found" } as const;
      }
      const result = await readConsultationResult({ artifacts: deps.artifacts }, record);
      const proposed = result?.actions ?? [];
      const edits: Record<string, Record<string, unknown>> = {};
      for (const id of request.actionIds) {
        if (!proposed.some((action) => action.id === id)) {
          return { ok: false, error: "unknown_action" } as const;
        }
      }
      for (const [id, payload] of Object.entries(request.edits ?? {})) {
        const action = proposed.find((candidate) => candidate.id === id);
        if (!action || !request.actionIds.includes(id)) {
          return { ok: false, error: "unknown_action" } as const;
        }
        // An edit changes the fields it names; a new exact start replaces a range.
        const merged: Record<string, unknown> = { ...action.payload, ...payload };
        if (action.kind === "follow_up" && payload.startsAt) delete merged.range;
        const parsed = CONSULTATION_ACTION_PAYLOADS[action.kind].safeParse(merged);
        if (!parsed.success) return { ok: false, error: "invalid_edit" } as const;
        edits[id] = parsed.data as Record<string, unknown>;
      }
      return runAsTenant({ spaceId: record.spaceId, userId: record.ownerUserId }, async () => {
        const found = await findConnectorTarget(deps.prisma, record);
        const tools = found ? await discoverActionTools(deps, record, found) : {};
        const applied = await applyActions(
          {
            tools,
            claim: (actionId) => claimConsultationAction(deps.prisma, record.id, actionId),
            settle: (actionId, outcome) =>
              settleConsultationAction(deps.prisma, record.id, actionId, outcome),
            call: async (tool, args) =>
              found
                ? callConnectorTool(deps, record, found, tool, args, caller.requestedByUserId)
                : { ok: false },
            audit: (event) =>
              void recordSecurityEvent({
                type: event.type,
                spaceId: record.spaceId,
                metadata: {
                  consultationId: record.id,
                  partnerId: record.partnerId,
                  actionId: event.actionId,
                  kind: event.kind,
                  tool: event.tool,
                  outcome: event.outcome,
                },
              }),
          },
          proposed,
          {
            actionIds: request.actionIds,
            edits,
            consultationId: record.id,
            context: {
              clientId: record.context.clientId,
              ...(record.context.appointmentId
                ? { appointmentId: record.context.appointmentId }
                : {}),
            },
          },
        );
        return { ok: true, actions: applied } as const;
      });
    });
}

/** What became of each proposed action so far, over the actions as they were sealed. */
export async function consultationActionStates(
  prisma: PrismaClient,
  consultationId: string,
  proposed: readonly ConsultationAction[],
): Promise<ConsultationAction[]> {
  const runs = new Map(
    (await listConsultationActionRuns(prisma, consultationId)).map((run) => [run.actionId, run]),
  );
  return proposed.map((action) => {
    const run = runs.get(action.id);
    if (run?.status === "applied") return { ...action, status: "applied" };
    if (run?.status === "failed") {
      return { ...action, status: "failed", error: run.errorCode ?? "connector_failed" };
    }
    return action;
  });
}

type ModelCall = {
  tier: "fast" | "strong";
  operation: string;
  instructions: string;
  prompt: string;
};

/** One model call; a failure that is the customer's setup (no model, no credit) also reaches the partner. */
async function runModel(
  deps: ConsultationWiringDeps,
  record: ConsultationRecord,
  botId: string,
  call: ModelCall,
): Promise<string | undefined> {
  try {
    return await runModelOnce(deps, record, botId, call);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/No model is configured/i.test(message)) {
      await alertPartnerOfCause(deps, record.spaceId, "no_model");
    } else {
      await alertPartnerOfSetupFailure(deps, record.spaceId, classifyRunError(error, message));
    }
    throw error;
  }
}

async function runModelOnce(
  deps: ConsultationWiringDeps,
  record: ConsultationRecord,
  botId: string,
  call: ModelCall,
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
