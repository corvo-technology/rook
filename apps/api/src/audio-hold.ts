import type { JobPublisher } from "@corvo/adapter-kit";
import { audioTranscribeJob, runContinueJob } from "@corvo/adapter-kit";
import type { LocalSpeech } from "@corvo/adapters";
import { creditOrganization, voiceCatalogEntry } from "@corvo/adapters";
import { isAttachmentAudioMimeType } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { findDefaultVoiceCredential } from "@corvo/db";
import { getLogger } from "@corvo/logging";

type Owner = { spaceId: string; userId: string };

/** Whether audio sent to this owner's agents can be turned into text at all. */
export interface AudioHold {
  canTranscribe(actor: Owner): Promise<boolean>;
}

/**
 * Transcription is possible where the engine is the owner's own computer, where the selected
 * voice provider transcribes, or where the owner has no voice and pays with credits. Anywhere else a voice note is left as a file, exactly as before,
 * and no new job runs.
 */
export function createAudioHold(deps: {
  prisma: PrismaClient;
  localSpeech?: LocalSpeech | undefined;
  /** Set where customers on credits transcribe with the deployment's key. */
  voiceCredits?: { apiKey: string } | undefined;
}): AudioHold {
  return {
    async canTranscribe(actor) {
      if (deps.localSpeech) return true;
      const credential = await findDefaultVoiceCredential(deps.prisma, actor);
      if (credential) return Boolean(voiceCatalogEntry(credential.provider)?.transcribe);
      return Boolean(deps.voiceCredits && (await creditOrganization(deps.prisma, actor)));
    },
  };
}

/**
 * Starts a run, or holds it while the owner's voice note is transcribed. A held run is marked so
 * the reconciler does not start it early; the transcription job clears the mark and starts it.
 * If the hold cannot be set up the run starts at once with the audio as a file.
 */
export async function startRunOrAwaitAudio(
  deps: {
    jobs: Pick<JobPublisher, "enqueue">;
    prisma: PrismaClient;
    audio?: AudioHold | undefined;
  },
  input: {
    runId: string;
    /** The message that carries the audio. A run is held only for the message it was made for. */
    messageId: string;
    actor: Owner;
    /** Only the owner's own audio uses the engine; anyone else's stays a file... */
    fromOwner: boolean;
    /** ...unless it comes from a visitor on a linked WhatsApp number, whose audio is bounded elsewhere. */
    allowVisitor?: boolean;
    attachments: ReadonlyArray<{ mimeType: string }>;
  },
): Promise<"started" | "held"> {
  const hasAudio = input.attachments.some((file) => isAttachmentAudioMimeType(file.mimeType));
  if (deps.audio && (input.fromOwner || input.allowVisitor) && hasAudio) {
    const possible = await deps.audio.canTranscribe(input.actor).catch(() => false);
    // A message sent while the agent is already working steers that run instead of starting one:
    // the run belongs to an earlier message, and may be running, so it is not held again.
    const run = possible
      ? await deps.prisma.run
          .findUnique({
            where: { id: input.runId },
            select: { sourceMessageId: true, status: true },
          })
          .catch(() => null)
      : null;
    if (run?.status === "queued" && run.sourceMessageId === input.messageId) {
      try {
        await deps.prisma.run.update({
          where: { id: input.runId },
          data: { awaitingAudioAt: new Date() },
        });
        await deps.jobs.enqueue(audioTranscribeJob(input.runId));
        return "held";
      } catch (error) {
        getLogger().error("audio hold failed; starting the run", error);
        try {
          await deps.prisma.run.update({
            where: { id: input.runId },
            data: { awaitingAudioAt: null },
          });
        } catch {
          // Best effort: the reconciler starts a run held this long without waiting for a job.
        }
      }
    }
  }
  await deps.jobs.enqueue(runContinueJob(input.runId));
  return "started";
}
