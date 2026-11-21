import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { ciphertextKeyId, decryptText, encryptText } from "./content-crypto.js";
import { contentEncryptionOf } from "./content-encryption.js";

/** Largest result kept whole; anything past it is cut with a note, never silently. */
export const RUN_TOOL_RESULT_MAX_CHARS = 4_000_000;
/** Results one run may keep; past it the caller falls back to clipping. */
export const RUN_TOOL_RESULT_MAX_PER_RUN = 100;
export const RUN_TOOL_RESULT_PAGE_DEFAULT = 4_000;
export const RUN_TOOL_RESULT_PAGE_MAX = 6_000;
export const RUN_TOOL_RESULT_MATCH_LIMIT = 20;
const GREP_CONTEXT_DEFAULT = 120;
const GREP_CONTEXT_MAX = 400;

type Store = Pick<PrismaClient, "runToolResult">;
export interface RunToolResultScope {
  runId: string;
  spaceId: string;
}

const locationOf = (runId: string, toolCallId: string) => ({
  table: "run_tool_results",
  column: "text",
  rowId: `${runId}:${toolCallId}`,
  owner: runId,
});

/**
 * Keep the full text of one tool call for its run. Returns the handle the agent reads it back
 * with, or undefined when the run already keeps its share (the caller then clips as before).
 * Content is sealed with the space key like the run's turn checkpoint.
 */
export async function saveRunToolResult(
  prisma: PrismaClient,
  run: RunToolResultScope,
  input: { toolCallId: string; toolName: string; text: string },
): Promise<string | undefined> {
  const where = { runId_toolCallId: { runId: run.runId, toolCallId: input.toolCallId } };
  const existing = await prisma.runToolResult.findUnique({ where, select: { id: true } });
  if (!existing) {
    const count = await prisma.runToolResult.count({ where: { runId: run.runId } });
    if (count >= RUN_TOOL_RESULT_MAX_PER_RUN) return undefined;
  }
  const text =
    input.text.length > RUN_TOOL_RESULT_MAX_CHARS
      ? `${input.text.slice(0, RUN_TOOL_RESULT_MAX_CHARS)}\n[Stored output was cut at ${RUN_TOOL_RESULT_MAX_CHARS} characters.]`
      : input.text;
  const encryption = contentEncryptionOf(prisma);
  const sealed = encryption?.ring.encryptWrites
    ? encryptText(
        await encryption.ring.current(run.spaceId),
        locationOf(run.runId, input.toolCallId),
        text,
      )
    : text;
  const row = await prisma.runToolResult.upsert({
    where,
    create: {
      id: randomUUID(),
      runId: run.runId,
      spaceId: run.spaceId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      totalChars: text.length,
      text: sealed,
    },
    update: { toolName: input.toolName, totalChars: text.length, text: sealed },
    select: { id: true },
  });
  return row.id;
}

export interface RunToolResultRead {
  handle: string;
  tool: string;
  totalChars: number;
  /** Characters returned in `text`, from `offset`. */
  offset?: number;
  text?: string;
  /** Where the next page starts; absent at the end. */
  nextOffset?: number;
  /** Literal case-insensitive matches of `grep` at or after `offset`. */
  matches?: Array<{ offset: number; text: string }>;
  hasMoreMatches?: boolean;
}

/**
 * Page or search a stored result. Only the run that produced it, in its space, can read it;
 * a handle from another run or space is the same as an unknown one.
 */
export async function readRunToolResult(
  prisma: PrismaClient,
  scope: RunToolResultScope,
  input: { handle: string; offset?: number; length?: number; grep?: string; context?: number },
): Promise<RunToolResultRead | undefined> {
  const row = await prisma.runToolResult.findFirst({
    where: { id: input.handle, runId: scope.runId, spaceId: scope.spaceId },
    select: { toolCallId: true, toolName: true, text: true },
  });
  if (!row) return undefined;
  const text = await open(prisma, scope, row.toolCallId, row.text);
  const offset = Math.min(Math.max(0, Math.floor(input.offset ?? 0)), text.length);
  const base = { handle: input.handle, tool: row.toolName, totalChars: text.length };
  const needle = input.grep?.trim();
  if (needle) {
    const context = Math.min(
      Math.max(0, Math.floor(input.context ?? GREP_CONTEXT_DEFAULT)),
      GREP_CONTEXT_MAX,
    );
    const haystack = text.toLowerCase();
    const lowered = needle.toLowerCase();
    const matches: Array<{ offset: number; text: string }> = [];
    let at = haystack.indexOf(lowered, offset);
    while (at !== -1 && matches.length < RUN_TOOL_RESULT_MATCH_LIMIT) {
      matches.push({
        offset: at,
        text: text.slice(Math.max(0, at - context), at + lowered.length + context),
      });
      at = haystack.indexOf(lowered, at + lowered.length);
    }
    return { ...base, matches, ...(at === -1 ? {} : { hasMoreMatches: true }) };
  }
  const length = Math.min(
    Math.max(1, Math.floor(input.length ?? RUN_TOOL_RESULT_PAGE_DEFAULT)),
    RUN_TOOL_RESULT_PAGE_MAX,
  );
  const end = Math.min(text.length, offset + length);
  return {
    ...base,
    offset,
    text: text.slice(offset, end),
    ...(end < text.length ? { nextOffset: end } : {}),
  };
}

async function open(
  prisma: PrismaClient,
  scope: RunToolResultScope,
  toolCallId: string,
  stored: string,
): Promise<string> {
  const keyId = ciphertextKeyId(stored);
  if (!keyId) return stored;
  const encryption = contentEncryptionOf(prisma);
  if (!encryption) throw new Error("Tool result encryption is unavailable");
  const key = await encryption.ring.byId(keyId);
  if (key.spaceId !== scope.spaceId) throw new Error("Tool result space mismatch");
  return decryptText(key, locationOf(scope.runId, toolCallId), stored);
}

/** Drop what runs kept; call when they end. Deleting a run or space cascades regardless. */
export async function clearRunToolResults(prisma: Store, runIds: readonly string[]): Promise<void> {
  if (runIds.length === 0) return;
  await prisma.runToolResult.deleteMany({ where: { runId: { in: [...runIds] } } });
}
