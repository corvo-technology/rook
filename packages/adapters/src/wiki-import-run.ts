import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  ArtifactStore,
  JobPublisher,
} from "@corvo/adapter-kit";
import { createAdapterContext, wikiImportJob } from "@corvo/adapter-kit";
import { ATTACHMENT_MAX_BYTES, attachmentSizeLabel } from "@corvo/contracts";
import {
  buildCuratorPrompt,
  CURATOR_RULES,
  type CuratorOp,
  curatorSystemPrompt,
  type DocumentSection,
  documentCuratorInstructions,
  documentParts,
  mergeImportOps,
  parseWikiPage,
  pdfSections,
  textSections,
} from "@corvo/core";
import type { PrismaClient, ThreadEvents } from "@corvo/db";
import {
  createWikiChange,
  createWikiImport,
  finishWikiImport,
  getWikiImport,
  getWikiSettings,
  listWikiChanges,
  listWikiPages,
  progressWikiImport,
  readWikiPage,
} from "@corvo/db";
import { getLogger, redactSensitiveText } from "@corvo/logging";
import {
  DocumentTextError,
  documentKind,
  extractPdfText,
  unsupportedDocumentMessage,
} from "./document-text.js";
import { extractOfficeText } from "./office-text.js";
import { findAttachedDocument } from "./thread-documents.js";
import { formatWikiIndex } from "./wiki-context.js";
import { askCurator, postWikiChangeCard, relatedWikiPages } from "./wiki-curator-run.js";

const INDEX_BYTES = 4 * 1024;
/** A part whose answer is not usable is asked again this many times before the import fails. */
const PART_ATTEMPTS = 2;
/** The most of a file's text kept as the source of what was learned from it. */
const SOURCE_MAX_CHARS = 200_000;

export type WikiImportDeps = {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  events: ThreadEvents;
  artifacts: Pick<ArtifactStore, "get" | "remove">;
  maxUploadSizeBytes?: number;
  resolveFastModel?: (scope: {
    userId: string;
    spaceId: string;
  }) => Promise<AgentRunRequest["model"] | undefined>;
};

export type WikiImportPayload = {
  importId: string;
  storageKey: string;
  mimeType: string;
  threadId?: string;
  temporary?: boolean;
};

/** A reason the person can act on; anything else is logged and said in general words. */
class ImportFailure extends Error {}

async function sectionsOf(
  bytes: Uint8Array,
  name: string,
  mimeType: string,
): Promise<{ sections: DocumentSection[]; notes: string[] }> {
  const kind = documentKind(name, mimeType);
  if (kind === "pdf") {
    const pdf = await extractPdfText(bytes);
    return {
      sections: pdfSections(pdf.pages.map((page) => redactSensitiveText(page))),
      notes: [],
    };
  }
  if (kind === "text") {
    return {
      sections: textSections(redactSensitiveText(new TextDecoder("utf-8").decode(bytes))),
      notes: [],
    };
  }
  if (kind) {
    // Masked before anything else sees it, as a PDF's pages are.
    const office = extractOfficeText(bytes, kind);
    return {
      sections: office.sections.map((part) => ({
        label: part.label,
        text: redactSensitiveText(part.text),
      })),
      notes: office.notes,
    };
  }
  throw new ImportFailure(unsupportedDocumentMessage(name, mimeType));
}

/**
 * Reads a file into the wiki part by part. The curator reads each part of the file as it reads a
 * conversation, and what it keeps is one change that cites the file and the page or part each fact
 * came from, under the same approval rules as any other change: new pages at once, edits wait.
 * Whatever goes wrong ends as a failed import the person can read; nothing is half written.
 */
export async function importFileToWiki(
  deps: WikiImportDeps,
  payload: WikiImportPayload,
): Promise<void> {
  const { prisma } = deps;
  const row = await getWikiImport(prisma, payload.importId);
  if (!row || row.state !== "reading") return;
  const scope = { spaceId: row.spaceId, userId: row.userId };
  const context = createAdapterContext(scope, "wiki-import", `wiki-import:${row.id}`);
  try {
    await readIntoWiki(deps, payload, { id: row.id, name: row.name, scope, context });
  } catch (error) {
    if (error instanceof ImportFailure || error instanceof DocumentTextError) {
      await finishWikiImport(prisma, row.id, { error: error.message });
    } else {
      getLogger().error("wiki import", error);
      await finishWikiImport(prisma, row.id, {
        error: "Reading this file did not work. Try again.",
      });
    }
  } finally {
    if (payload.temporary)
      await deps.artifacts.remove(payload.storageKey, context).catch(() => undefined);
  }
}

async function readIntoWiki(
  deps: WikiImportDeps,
  payload: WikiImportPayload,
  file: {
    id: string;
    name: string;
    scope: { spaceId: string; userId: string };
    context: ReturnType<typeof createAdapterContext>;
  },
): Promise<void> {
  const { prisma } = deps;
  const { scope, name } = file;
  const model = await deps.resolveFastModel?.(scope);
  if (!model || model.provider === "scripted")
    throw new ImportFailure("No model is ready to read this file.");
  const limit = deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES;
  const bytes = await deps.artifacts.get(payload.storageKey, file.context);
  if (bytes.byteLength > limit)
    throw new ImportFailure(
      `This file is too large to read (the limit is ${attachmentSizeLabel(limit)}).`,
    );
  const { sections, notes } = await sectionsOf(bytes, name, payload.mimeType);
  const { parts, truncated } = documentParts(sections);
  if (!parts.length)
    throw new ImportFailure("This file has no text to read, as a scanned document has.");
  await progressWikiImport(prisma, file.id, { parts: parts.length });

  const [pages, waiting, rules] = await Promise.all([
    listWikiPages(prisma, scope),
    listWikiChanges(prisma, scope, { state: ["pending"] }),
    readWikiPage(prisma, scope, "Wiki rules"),
  ]);
  const index = formatWikiIndex(pages, INDEX_BYTES);
  const instructions = [
    curatorSystemPrompt(
      rules ? parseWikiPage(rules.body).body.trim() || CURATOR_RULES : CURATOR_RULES,
    ),
    documentCuratorInstructions(name),
  ].join("\n");
  const waitingLines = waiting.flatMap((change) =>
    change.pages.map((page) => `[[${page.title}]] ${page.op}`),
  );

  const partOps: CuratorOp[][] = [];
  for (const [number, part] of parts.entries()) {
    const planned = mergeImportOps(partOps).map((op) => `[[${op.page}]] ${op.op}`);
    const prompt = buildCuratorPrompt({
      index,
      related: await relatedWikiPages(prisma, scope, part.text),
      pending: [...waitingLines, ...new Set(planned)],
      messages: [{ author: `${name}, ${part.label}`, text: part.text }],
    });
    let ops: CuratorOp[] | undefined;
    for (let attempt = 1; !ops; attempt += 1) {
      try {
        ops = (
          await askCurator(deps, {
            scope,
            model,
            botId: "wiki-curator",
            threadId: payload.threadId ?? `wiki-import:${file.id}`,
            runId: `wiki-import:${file.id}:${number}:${attempt}`,
            operationId: `wiki-import:${file.id}`,
            prompt,
            instructions,
          })
        ).ops;
      } catch (error) {
        if (attempt >= PART_ATTEMPTS) throw error;
      }
    }
    partOps.push(ops);
    await progressWikiImport(prisma, file.id, { readParts: number + 1 });
  }

  const ops = mergeImportOps(partOps);
  const settings = await getWikiSettings(prisma, scope.spaceId);
  const change = ops.length
    ? await createWikiChange(prisma, scope, {
        source: {
          origin: "file",
          title: name,
          text: parts
            .map((part) => `${part.label}\n${part.text}`)
            .join("\n\n")
            .slice(0, SOURCE_MAX_CHARS),
          ...(payload.threadId ? { threadId: payload.threadId } : {}),
        },
        ops,
        reason: [
          truncated
            ? `Read from ${name}, only as far as its first ${parts.length} parts.`
            : `Read from ${name}.`,
          ...notes,
        ].join(" "),
        anchor: payload.threadId ? { threadId: payload.threadId } : {},
        edits: settings.edits,
      })
    : null;
  if (!change) throw new ImportFailure("Nothing in this file was new or worth keeping.");
  await finishWikiImport(prisma, file.id, undefined);
  if (payload.threadId) {
    const thread = await prisma.thread.findUnique({
      where: { id: payload.threadId },
      select: {
        id: true,
        spaceId: true,
        groupId: true,
        botId: true,
        externalConversationId: true,
        wikiCapture: true,
      },
    });
    if (thread) await postWikiChangeCard({ prisma, events: deps.events }, thread, change);
  }
}

/**
 * An agent's request to keep a file attached in this conversation: the read is queued and the
 * answer comes at once, since reading a long file takes a while. What is kept shows up as the
 * conversation's change card, as it does for anything the curator reads.
 */
export async function startAttachedFileImport(
  deps: { prisma: PrismaClient; jobs: JobPublisher; maxUploadSizeBytes?: number },
  input: { threadId: string; context: AdapterContext; file: string },
): Promise<Record<string, unknown>> {
  const found = await findAttachedDocument(deps.prisma, input.threadId, input.context, input.file);
  if ("error" in found) return found;
  const { artifact } = found;
  if (!documentKind(artifact.name, artifact.mimeType))
    return {
      error: `"${artifact.name}" cannot be read. ${unsupportedDocumentMessage(artifact.name, artifact.mimeType)}`,
    };
  const limit = deps.maxUploadSizeBytes ?? ATTACHMENT_MAX_BYTES;
  if (artifact.size > limit)
    return {
      error: `"${artifact.name}" is too large to read (the limit is ${attachmentSizeLabel(limit)}).`,
    };
  const row = await createWikiImport(deps.prisma, input.context, artifact.name);
  await deps.jobs.enqueue(
    wikiImportJob({
      importId: row.id,
      storageKey: artifact.storageKey,
      mimeType: artifact.mimeType,
      threadId: input.threadId,
    }),
  );
  return {
    ok: true,
    status: "reading",
    file: artifact.name,
    note: "The file is being read into the wiki. Say so; do not wait for it. What is kept shows in this conversation when it is done.",
  };
}
