import type {
  AgentHomeStore,
  AgentRuntime,
  ArtifactStore,
  BackgroundJobExecution,
  BackgroundJobHandlers,
  JobPublisher,
  MessagingSurface,
  SandboxProvider,
  SecretStore,
} from "@corvo/adapter-kit";
import { messagingDeliverJob } from "@corvo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@corvo/db";
import { runAsSystem, runAsTenant } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { createAnnouncer, runAudioTranscribeJob } from "./audio-transcribe-job.js";
import {
  dbVoiceCredential,
  prismaConsent,
  transcribeAudioArtifact,
} from "./audio-transcription.js";
import { chooseBotPiece } from "./avatar-design.js";
import { settleCallRequest } from "./call-request.js";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import { expireComputerControl } from "./computer-control.js";
import { scheduleComputerSleep, sleepComputerIfIdle } from "./computer-idle.js";
import { performComputerUpdate } from "./computer-update.js";
import type { createRunExecutor } from "./executor.js";
import type { ExpoPushProvider } from "./expo-push.js";
import { compactHistory } from "./history-compaction.js";
import type { LocalSpeech } from "./local-speech.js";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";
import { deliverMessagingOutbound, mirrorMessagingOutbound } from "./messaging-delivery.js";
import { expireTaughtSkillTeaching } from "./teaching-session.js";
import { WHATSAPP_THREAD_PREFIX } from "./whatsapp/link-surface.js";
import { curateWiki } from "./wiki-curator-run.js";
import { retryWikiChange, reviewWiki } from "./wiki-review-run.js";

type Tenant = { spaceId: string; userId: string };

/** Stands in where a process has no messaging platform: it lists none and sends nothing. */
const NO_MESSAGING_SURFACE: MessagingSurface = {
  describe: () => ({
    id: "none",
    contractVersion: "1",
    adapterVersion: "1",
    capabilities: { providers: [] },
  }),
  platforms: () => [],
  handleWebhook: () => null,
  onInbound: () => undefined,
  sendToThread: () => Promise.reject(new Error("No messaging platform is configured here")),
  openDirectThread: () => Promise.reject(new Error("No messaging platform is configured here")),
  acknowledge: async () => undefined,
};

/**
 * A job that acts for one run, routine, computer, skill, thread or cloud agent runs
 * as that row's tenant, so row-level security keeps it, and every tool it runs, in
 * the owner's Space even where a query forgets to filter. The owner comes from one
 * narrow system read; when the row is gone there is nothing left to act on.
 */
function asOwner<Key, P extends Key>(
  owner: (payload: Key) => Promise<Tenant | null>,
  handler: (payload: P, execution?: BackgroundJobExecution) => Promise<void>,
): (payload: P, execution?: BackgroundJobExecution) => Promise<void> {
  return async (payload, execution) => {
    const tenant = await runAsSystem("find the tenant a background job acts for", () =>
      owner(payload),
    );
    if (tenant) await runAsTenant(tenant, () => handler(payload, execution));
  };
}

/** A review or a retry names the member it works for; that member's Space is where it runs. */
const wikiScope = async (payload: Tenant): Promise<Tenant> => ({
  spaceId: payload.spaceId,
  userId: payload.userId,
});

const OWNER = { spaceId: true, userId: true } as const;

export function createBackgroundJobHandlers(deps: {
  executor: ReturnType<typeof createRunExecutor>;
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  artifacts: ArtifactStore;
  jobs: JobPublisher;
  events: ThreadEvents;
  workerId: string;
  runtime: AgentRuntime;
  secretStore: SecretStore;
  memoryProviders: MemoryProviderResolver;
  deploymentModelKey?: string;
  deploymentModelConfigured?: boolean;
  messaging?: MessagingSurface;
  cloudAgent?: CloudAgentConnection | null;
  notifications?: ExpoPushProvider;
  /** Present only on the desktop app's own engine: where speech models live. */
  localSpeech?: LocalSpeech;
  /** The operator's allowance for self-hosted speech servers on private addresses. */
  allowPrivateEndpoint?: boolean;
}): BackgroundJobHandlers {
  const audioTranscription = {
    prisma: deps.prisma,
    artifacts: deps.artifacts,
    ...(deps.localSpeech ? { localSpeech: deps.localSpeech } : {}),
    loadVoiceCredential: dbVoiceCredential(deps.prisma, deps.secretStore),
    hasConsent: prismaConsent(deps.prisma),
    ...(deps.allowPrivateEndpoint === undefined
      ? {}
      : { allowPrivateEndpoint: deps.allowPrivateEndpoint }),
  };
  const audioJob = {
    prisma: deps.prisma,
    jobs: deps.jobs,
    transcribe: (input: Parameters<typeof transcribeAudioArtifact>[1]) =>
      transcribeAudioArtifact(audioTranscription, input),
    announce: createAnnouncer({ prisma: deps.prisma, events: deps.events, jobs: deps.jobs }),
  };
  // The worker may have no messaging platform of its own (a desktop with no Telegram). It still
  // queues the replies of linked WhatsApp conversations, which the API process sends.
  const messagingDeps = {
    prisma: deps.prisma,
    messaging: deps.messaging ?? NO_MESSAGING_SURFACE,
    events: deps.events,
    jobs: deps.jobs,
    artifacts: deps.artifacts,
    // A linked WhatsApp number's socket lives in the API process, so the worker never sends
    // those rows; the API process does.
    outboxScope: { skipThreadPrefix: WHATSAPP_THREAD_PREFIX },
    ...(deps.messaging ? {} : { linkedOnly: true }),
  };
  // The outbox holds every Space's pending sends, so draining it is cross-tenant.
  const drainMessaging = async () => {
    await runAsSystem("drain the messaging outbox across Spaces", () =>
      deliverMessagingOutbound(
        messagingDeps,
        {},
        {
          operationId: "messaging.deliver:drain",
          traceId: "messaging.deliver:drain",
          spaceId: "",
          userId: "",
          signal: new AbortController().signal,
        },
      ),
    );
  };
  const run = ({ runId }: { runId: string }) =>
    deps.prisma.run.findUnique({ where: { id: runId }, select: OWNER });
  const routine = ({ routineId }: { routineId: string }) =>
    deps.prisma.routine.findUnique({ where: { id: routineId }, select: OWNER });
  const computer = ({ computerId }: { computerId: string }) =>
    deps.prisma.computer.findUnique({ where: { id: computerId }, select: OWNER });
  const thread = ({ threadId }: { threadId: string }) =>
    deps.prisma.thread.findUnique({ where: { id: threadId }, select: OWNER });
  const bot = ({ botId }: { botId: string }) =>
    deps.prisma.bot.findUnique({ where: { id: botId }, select: OWNER });
  const skill = ({ skillId }: { skillId: string }) =>
    deps.prisma.taughtSkill.findUnique({ where: { id: skillId }, select: OWNER });
  const cloudAgent = ({ agentId }: { agentId: string }) =>
    deps.prisma.cloudAgent.findUnique({ where: { id: agentId }, select: OWNER });
  const updatedComputer = async ({ updateId }: { updateId: string }) =>
    (
      await deps.prisma.computerUpdate.findUnique({
        where: { id: updateId },
        select: { computer: { select: OWNER } },
      })
    )?.computer ?? null;

  return {
    "run.continue": asOwner(run, async (payload, execution) => {
      if (execution)
        await deps.executor.continueRun(payload.runId, deps.workerId, execution.onRunStarted);
      else await deps.executor.continueRun(payload.runId, deps.workerId);
      // Automatic messaging mirror: once the run's bot messages are durable,
      // copy them into the outbox. Never let mirror failures fail the run.
      await mirrorMessagingOutbound(messagingDeps, payload.runId);
      await deps.jobs.enqueue(messagingDeliverJob()).catch(async (error) => {
        getLogger().error("messaging.deliver enqueue error", error);
        await drainMessaging();
      });
    }),
    "messaging.credential-cleanup": async ({ installationId, ref }) => {
      await runAsSystem("clean up a retired messaging credential", async () => {
        const installation = await deps.prisma.messagingInstallation.findUnique({
          where: { id: installationId },
          select: { ciphertext: true },
        });
        if (installation?.ciphertext === ref) return;
        await deps.secretStore.delete(ref, {
          recordId: installationId,
          signal: AbortSignal.timeout(10_000),
        });
      });
    },
    "messaging.deliver": async ({ runId }) => {
      if (runId) {
        await asOwner(run, () => mirrorMessagingOutbound(messagingDeps, runId))({ runId });
      }
      await drainMessaging();
    },
    "audio.transcribe": asOwner(run, async (payload) => {
      await runAudioTranscribeJob(audioJob, payload);
    }),
    "routine.wakeup": asOwner(routine, async (payload) => {
      await deps.executor.wakeRoutine(payload.routineId, payload.scheduledFor);
    }),
    "routine.retry": asOwner(run, async (payload) => {
      await deps.executor.retryRoutineRun(payload.runId);
    }),
    "routine.next-step": asOwner(run, async (payload) => {
      await deps.executor.startNextRoutineStep(payload.runId);
    }),
    "computer.update": asOwner(updatedComputer, async ({ updateId }) => {
      await performComputerUpdate(deps, updateId);
    }),
    "computer.sleep": asOwner(computer, async (payload) => {
      await sleepComputerIfIdle(deps, payload.computerId);
    }),
    "computer.control-expire": asOwner(computer, async (payload) => {
      if (await expireComputerControl(deps, payload.computerId, payload.leaseId)) {
        scheduleComputerSleep(deps.jobs, payload.computerId);
      }
    }),
    "skill.teaching-expire": asOwner(skill, async (payload) => {
      await expireTaughtSkillTeaching(deps, payload.skillId);
    }),
    "call.expire": asOwner(thread, async (payload) => {
      await settleCallRequest(deps, { ...payload, from: ["ringing"], status: "missed" });
    }),
    "cloud_agent.poll": asOwner(cloudAgent, async (payload) => {
      await pollCloudAgent(
        { prisma: deps.prisma, jobs: deps.jobs, events: deps.events, cloudAgent: deps.cloudAgent },
        payload,
      );
    }),
    // A receipt belongs to a device's push token, not to a Space.
    "push.receipt": async (payload) => {
      await runAsSystem("check a push receipt", () => deps.notifications?.checkReceipt(payload));
    },
    "bot.design-avatar": asOwner(bot, async (payload) => {
      await chooseBotPiece(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          events: deps.events,
          resolveModel: deps.executor.resolveModel,
          resolveFastModel: deps.executor.resolveFastModel,
        },
        payload,
      );
    }),
    "wiki.curate": asOwner(thread, async (payload) => {
      await curateWiki(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          events: deps.events,
          jobs: deps.jobs,
          resolveFastModel: deps.executor.resolveFastModel,
        },
        payload,
      );
    }),
    "wiki.review": asOwner(wikiScope, async (payload) => {
      await reviewWiki(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          resolveFastModel: deps.executor.resolveFastModel,
        },
        payload,
      );
    }),
    "wiki.retry": asOwner(wikiScope, async (payload) => {
      await retryWikiChange(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          resolveFastModel: deps.executor.resolveFastModel,
        },
        payload,
      );
    }),
    "history.compact": asOwner(thread, async (payload) => {
      // Retrieval policies use stored context without paid message-count compaction.
      // Skip legacy backlog work after a policy change.
      if (deps.executor.contextStrategy && deps.executor.contextStrategy !== "current") return;
      const compaction = {
        prisma: deps.prisma,
        runtime: deps.runtime,
        jobs: deps.jobs,
        memoryProviders: deps.memoryProviders,
        deploymentModelKey: deps.deploymentModelKey,
        deploymentModelConfigured: deps.deploymentModelConfigured,
        ...(deps.executor.resolveModel ? { resolveModel: deps.executor.resolveModel } : {}),
        resolveFastModel: deps.executor.resolveFastModel,
      };
      if (payload.keepRecent === undefined) {
        await compactHistory(compaction, payload.threadId);
      } else {
        await compactHistory(compaction, payload.threadId, { keepRecent: payload.keepRecent });
      }
    }),
  };
}
