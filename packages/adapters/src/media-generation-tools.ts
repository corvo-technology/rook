import type {
  AdapterContext,
  GeneratedMedia,
  MediaGenerationInput,
  MediaGenerationProvider,
  MediaReferenceImage,
  MediaVideoJob,
} from "@corvo/adapter-kit";
import { MediaGenerationError } from "@corvo/adapter-kit";
import type { MessageBlock } from "@corvo/contracts";
import { messageBlockForArtifact } from "@corvo/core";
import type { ExternalEffect, PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { z } from "zod";
import type { MediaCredits } from "./media-credits.js";
import { MediaCreditsError } from "./media-credits.js";
import { mediaPromptSchema, validateGeneratedMedia } from "./media-generation-provider.js";

const JOB_KIND = "media_generation_job";
const MEDIA_EXTENSIONS: Record<GeneratedMedia["mimeType"], string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
};
const savedJob = z
  .object({
    provider: z.string(),
    jobId: z.string().optional(),
    artifactIds: z.array(z.string()).optional(),
    /** Written by earlier releases, which made one picture per job. */
    artifactId: z.string().optional(),
  })
  .transform(({ artifactId, artifactIds, ...rest }) => ({
    ...rest,
    artifactIds: artifactIds ?? (artifactId ? [artifactId] : []),
  }));
/** What a job has stored so far; `artifactIds` appears once the first picture is attached. */
export type MediaJobResult = { provider: string; jobId?: string; artifactIds?: string[] };
const NO_REFERENCES =
  "This image model cannot work from reference pictures. Ask for a new image without one.";
const REFERENCES_UNAVAILABLE =
  "A reference image is unavailable. Use an image from this conversation.";
const completed = (artifactIds: string[]) => ({
  status: "completed",
  artifactId: artifactIds[0],
  artifactIds,
});
export async function generateMediaFromTool(options: {
  name: "generate_image" | "generate_video";
  args: Record<string, unknown>;
  executionId: string;
  /** Recover only persisted state; never submit a new billed generation. */
  recoverOnly?: boolean;
  provider: MediaGenerationProvider;
  /** Where an image is paid from; without it the deployment bears the cost. */
  credits?: MediaCredits;
  prisma: PrismaClient;
  context: AdapterContext;
  run: { id: string; threadId: string; botId: string; userId: string; spaceId: string };
  /**
   * Reads the pictures an image starts from, or returns undefined when any of them is not one
   * this conversation can see.
   */
  loadReferences?: (ids: string[]) => Promise<MediaReferenceImage[] | undefined>;
  attach: (
    output: GeneratedMedia,
    name: string,
    job: { id: string; result: MediaJobResult },
  ) => Promise<{ artifactId: string; block: MessageBlock }>;
  publish: (blocks: MessageBlock[], jobId: string, artifactIds: string[]) => Promise<unknown>;
}) {
  const { provider, prisma, context, run, args } = options;
  const video = options.name === "generate_video";
  if (!(video ? provider.capabilities.video : provider.capabilities.images))
    return { error: "Media generation is unavailable." };
  try {
    if (
      args.jobId !== undefined &&
      (!video ||
        typeof args.jobId !== "string" ||
        !args.jobId ||
        args.jobId.length > 200 ||
        args.prompt !== undefined)
    ) {
      return { error: "Use a prompt to submit or jobId alone to poll a video." };
    }
    let reservation: ExternalEffect | null = null;
    let polling = false;
    let imageInput: MediaGenerationInput | undefined;
    if (video && typeof args.jobId === "string") {
      reservation = await prisma.externalEffect.findFirst({
        where: {
          id: args.jobId,
          kind: JOB_KIND,
          spaceId: run.spaceId,
          run: { userId: run.userId, botId: run.botId, threadId: run.threadId },
        },
      });
      if (!reservation) return { error: "Video job is unavailable." };
      const saved = savedJob.safeParse(reservation.result);
      if (!saved.success || saved.data.provider !== provider.id)
        return {
          error:
            "Video job provider changed or submission is uncertain. Do not resubmit automatically.",
        };
      if (saved.data.artifactIds.length && reservation.status === "media_completed")
        return completed(saved.data.artifactIds);
      if (reservation.status === "media_failed") return { status: "failed" };
      if (!saved.data.jobId && !saved.data.artifactIds.length)
        return { error: "Submission is uncertain. Do not resubmit automatically." };
    } else {
      const prior = await prisma.externalEffect.findFirst({
        where: {
          runId: run.id,
          kind: JOB_KIND,
          request: { path: ["executionId"], equals: options.executionId },
        },
      });
      if (prior) {
        const saved = savedJob.safeParse(prior.result);
        if (saved.success && saved.data.artifactIds.length) {
          if (prior.status === "media_completed") return completed(saved.data.artifactIds);
          reservation = prior;
        } else {
          if (video && saved.success && saved.data.jobId)
            return {
              jobId: prior.id,
              status: prior.status === "media_failed" ? "failed" : "queued",
            };
          if (options.recoverOnly) return undefined;
          return {
            jobId: prior.id,
            error: "Submission already attempted. Poll a video job; do not resubmit automatically.",
          };
        }
      }
      if (!reservation) {
        if (options.recoverOnly) return undefined;
        const input = mediaPromptSchema.safeParse(args);
        if (!input.success) return { error: "A prompt of 1–4000 characters is required." };
        const count = Math.min(input.data.count, provider.capabilities.maxCount);
        if (!video) {
          let references: MediaReferenceImage[] | undefined;
          if (input.data.referenceArtifactIds.length) {
            if (!provider.capabilities.references) return { error: NO_REFERENCES };
            references = await options.loadReferences?.(input.data.referenceArtifactIds);
            if (!references) return { error: REFERENCES_UNAVAILABLE };
          }
          imageInput = {
            prompt: input.data.prompt,
            ...(input.data.aspectRatio ? { aspectRatio: input.data.aspectRatio } : {}),
            count,
            ...(references ? { references } : {}),
          };
        }
        // A unique slot makes the per-run cap durable even across concurrent calls/restarts.
        for (let slot = 0; slot < 2; slot++) {
          try {
            reservation = await prisma.externalEffect.create({
              data: {
                spaceId: run.spaceId,
                runId: run.id,
                kind: JOB_KIND,
                idempotencyKey: `media:${run.id}:${slot}`,
                status: "media_submitting",
                request: {
                  tool: options.name,
                  prompt: input.data.prompt,
                  executionId: options.executionId,
                  ...(video
                    ? {}
                    : { count, referenceArtifactIds: input.data.referenceArtifactIds }),
                },
                result: { provider: provider.id },
              },
            });
            break;
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "P2002"))
              throw error;
          }
        }
        if (!reservation)
          return { error: "Media generation limit reached (two submissions per run)." };
      }
    }
    const saved = savedJob.parse(reservation.result);
    if (saved.artifactIds.length) {
      const rows = await prisma.artifact.findMany({
        where: {
          id: { in: saved.artifactIds },
          spaceId: run.spaceId,
          userId: run.userId,
          botId: run.botId,
        },
      });
      const found = saved.artifactIds.flatMap((id) => rows.find((row) => row.id === id) ?? []);
      if (!found.length) return { error: "Generated attachment is unavailable." };
      await options.publish(
        found.map(messageBlockForArtifact),
        reservation.id,
        found.map((row) => row.id),
      );
      return completed(found.map((row) => row.id));
    }
    if (video && typeof args.jobId === "string") {
      const claim = await prisma.externalEffect.updateMany({
        where: {
          id: reservation.id,
          OR: [
            { status: "media_pending" },
            { status: "media_polling", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
          ],
        },
        data: { status: "media_polling" },
      });
      if (!claim.count)
        return options.recoverOnly
          ? { jobId: reservation.id, status: "running" }
          : {
              error:
                "Video job is already being checked or needs recovery. Do not resubmit automatically.",
            };
      polling = true;
    }
    let output: MediaVideoJob | { status: "completed"; outputs: GeneratedMedia[] };
    try {
      output = video
        ? await submitOrPollVideo(provider, saved.jobId, args, context)
        : {
            status: "completed" as const,
            outputs: await generateImageOnCredit(
              provider,
              options.credits,
              reservation.id,
              // Only a fresh submission reaches here: a recovered one has its pictures already.
              imageInput ?? { prompt: mediaPromptSchema.parse(args).prompt },
              context,
            ),
          };
    } catch (error) {
      if (polling)
        await prisma.externalEffect.updateMany({
          where: { id: reservation.id, status: { not: "media_completed" } },
          data: { status: "media_pending" },
        });
      throw error;
    }
    if (video && "id" in output) {
      await prisma.externalEffect.updateMany({
        where: {
          id: reservation.id,
          status: { not: "media_completed" },
          result: { equals: saved },
        },
        data: {
          status:
            output.status === "failed"
              ? "media_failed"
              : output.status === "completed"
                ? "media_polling"
                : "media_pending",
          result: { provider: provider.id, jobId: output.id },
        },
      });
    }
    const outputs =
      "outputs" in output ? output.outputs : "output" in output ? [output.output] : [];
    if (output.status !== "completed")
      return {
        jobId: reservation.id,
        status: output.status,
        ...("progress" in output ? { progress: output.progress } : {}),
      };
    const attachedBlocks: MessageBlock[] = [];
    const artifactIds: string[] = [];
    let result: MediaJobResult = {
      provider: provider.id,
      ...("id" in output ? { jobId: output.id } : {}),
    };
    for (const [index, generated] of outputs.entries()) {
      validateGeneratedMedia(
        generated,
        video ? "video/mp4" : ["image/png", "image/jpeg", "image/webp"],
      );
      context.signal.throwIfAborted();
      const attached = await options.attach(
        generated,
        `generated-${reservation.id}${index ? `-${index + 1}` : ""}${MEDIA_EXTENSIONS[generated.mimeType]}`,
        { id: reservation.id, result },
      );
      attachedBlocks.push(attached.block);
      artifactIds.push(attached.artifactId);
      result = { ...result, artifactIds: [...artifactIds] };
    }
    await options.publish(attachedBlocks, reservation.id, artifactIds);
    return completed(artifactIds);
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof MediaCreditsError) return { error: error.message };
    return {
      error:
        error instanceof MediaGenerationError
          ? error.message
          : "Media generation failed. Submission may have been accepted; do not retry automatically.",
    };
  }
}

async function submitOrPollVideo(
  provider: MediaGenerationProvider,
  jobId: string | undefined,
  args: Record<string, unknown>,
  context: AdapterContext,
) {
  return jobId
    ? provider.pollVideo(jobId, context)
    : provider.generateVideo({ prompt: mediaPromptSchema.parse(args).prompt }, context);
}

/**
 * The pictures asked for, paid from the customer's credit when there is a wallet: the hold is the
 * model's worst case for all of them and comes first. It is settled at what the provider
 * reported (else the catalog price of the pictures made), returned in full when the provider
 * refused before generating, and left in place when it cannot be known whether they were made.
 */
async function generateImageOnCredit(
  provider: MediaGenerationProvider,
  credits: MediaCredits | undefined,
  jobId: string,
  input: MediaGenerationInput,
  context: AdapterContext,
): Promise<GeneratedMedia[]> {
  const hold = await credits?.hold({
    jobId,
    provider: provider.id,
    model: provider.imageModel,
    count: input.count ?? 1,
  });
  let outputs: GeneratedMedia[];
  try {
    outputs = await provider.generateImage(input, context);
  } catch (error) {
    if (error instanceof MediaGenerationError && !error.uncertain) await hold?.release();
    throw error;
  }
  const reported = outputs.filter((output) => output.costUsd !== undefined);
  const costUsd = reported.length
    ? reported.reduce((total, output) => total + (output.costUsd ?? 0), 0)
    : undefined;
  // The pictures exist; a failed settlement must not lose them. The hold stays and is visible.
  await hold
    ?.settle(costUsd, outputs.length)
    .catch((error) => getLogger().error("media credit settlement", error));
  return outputs;
}
