import type { AdapterContext, ArtifactStore, MediaReferenceImage } from "@corvo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";

const REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Reads the pictures an agent names as the start of an image. The agent can only name what the
 * conversation it is in can see: a channel's own files, or the files of this agent's own chat
 * with this person. Anything else, or anything that is not a picture the provider takes, makes
 * the whole request unavailable, so a guessed id never reveals that an artifact exists.
 */
export async function loadMediaReferences(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  scope: { spaceId: string; userId: string; botId: string; groupId: string | null },
  ids: readonly string[],
  context: AdapterContext,
): Promise<MediaReferenceImage[] | undefined> {
  const rows = await deps.prisma.artifact.findMany({
    where: {
      id: { in: [...ids] },
      spaceId: scope.spaceId,
      mimeType: { in: [...REFERENCE_TYPES] },
      ...(scope.groupId
        ? { groupId: scope.groupId }
        : { groupId: null, botId: scope.botId, userId: scope.userId }),
    },
  });
  const references: MediaReferenceImage[] = [];
  for (const id of ids) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return undefined;
    references.push({
      bytes: await deps.artifacts.get(row.storageKey, context),
      mimeType: row.mimeType as MediaReferenceImage["mimeType"],
    });
  }
  return references;
}

/** Most picture bytes one tool result carries back to the model. */
const RESULT_IMAGE_BYTES = ATTACHMENT_MAX_BYTES;

/**
 * A finished image goes back to the model as a picture too, when it can see, so it can check
 * the result before it answers. The ledger keeps only the plain result.
 */
export async function withGeneratedImages<T>(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  run: { spaceId: string; userId: string },
  result: T,
  context: AdapterContext,
): Promise<T | AgentImageToolResult> {
  const ids = (result as { artifactIds?: unknown } | undefined)?.artifactIds;
  if (!Array.isArray(ids) || !ids.length) return result;
  const rows = await deps.prisma.artifact.findMany({
    where: { id: { in: ids as string[] }, spaceId: run.spaceId, userId: run.userId },
  });
  const images: AgentImageToolResult["content"] = [];
  let budget = RESULT_IMAGE_BYTES;
  for (const id of ids) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || !REFERENCE_TYPES.has(row.mimeType) || row.size > budget) continue;
    try {
      const bytes = await deps.artifacts.get(row.storageKey, context);
      budget -= bytes.byteLength;
      images.push({
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType: row.mimeType,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
    }
  }
  if (!images.length) return result;
  return {
    kind: "agent_tool_result",
    content: [{ type: "text", text: JSON.stringify(result) }, ...images],
    details: result,
  };
}

export type AgentImageToolResult = {
  kind: "agent_tool_result";
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  details: unknown;
};
