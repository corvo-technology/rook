import type { PrismaClient } from "./client.js";

/** How far back the ledger is shown to an agent; older items may be raised again. */
export const SURFACED_WINDOW_DAYS = 14;
const MAX_LISTED = 30;
const MAX_KEY = 120;
const MAX_SUMMARY = 240;
const MAX_FINGERPRINT = 200;

export type SurfacedItemInput = {
  spaceId: string;
  botId: string;
  threadId: string;
  key: string;
  fingerprint?: string | null;
  summary: string;
  runId?: string | null;
};

const clip = (value: string, max: number) => value.trim().replace(/\s+/g, " ").slice(0, max);

/**
 * Record that the agent told this audience about an item. The same key updates its row, so the
 * ledger holds the latest version of each thing the agent raised, never a history.
 */
export async function recordSurfacedItem(
  prisma: Pick<PrismaClient, "surfacedItem">,
  input: SurfacedItemInput,
): Promise<{ key: string; changed: boolean } | { error: string }> {
  const key = clip(input.key, MAX_KEY);
  const summary = clip(input.summary, MAX_SUMMARY);
  if (!key) return { error: "key is required" };
  if (!summary) return { error: "summary is required" };
  const fingerprint = input.fingerprint ? clip(input.fingerprint, MAX_FINGERPRINT) : null;
  const where = { botId_threadId_key: { botId: input.botId, threadId: input.threadId, key } };
  const before = await prisma.surfacedItem.findUnique({ where, select: { fingerprint: true } });
  await prisma.surfacedItem.upsert({
    where,
    create: {
      spaceId: input.spaceId,
      botId: input.botId,
      threadId: input.threadId,
      key,
      fingerprint,
      summary,
      runId: input.runId ?? null,
    },
    update: { fingerprint, summary, runId: input.runId ?? null, surfacedAt: new Date() },
  });
  return { key, changed: !before || before.fingerprint !== fingerprint };
}

/** Whether a run already put an item in the ledger, so an automatic note is not added on top. */
export async function runSurfacedItems(
  prisma: Pick<PrismaClient, "surfacedItem">,
  runId: string,
): Promise<number> {
  return prisma.surfacedItem.count({ where: { runId } });
}

export type SurfacedItemRow = {
  key: string;
  fingerprint: string | null;
  summary: string;
  surfacedAt: Date;
};

/** What the agent already told this audience lately, newest first. */
export async function listSurfacedItems(
  prisma: Pick<PrismaClient, "surfacedItem">,
  scope: { botId: string; threadId: string },
  now: Date = new Date(),
): Promise<SurfacedItemRow[]> {
  return prisma.surfacedItem.findMany({
    where: {
      botId: scope.botId,
      threadId: scope.threadId,
      surfacedAt: { gte: new Date(now.getTime() - SURFACED_WINDOW_DAYS * 86_400_000) },
    },
    orderBy: { surfacedAt: "desc" },
    take: MAX_LISTED,
    select: { key: true, fingerprint: true, summary: true, surfacedAt: true },
  });
}

/** The ledger as the agent reads it in a background run; undefined when it is empty. */
export function surfacedItemsInstruction(rows: readonly SurfacedItemRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  const lines = rows.map(
    (row) =>
      `- ${row.key}${row.fingerprint ? ` [${row.fingerprint}]` : ""}: ${row.summary} (${row.surfacedAt.toISOString().slice(0, 10)})`,
  );
  return [
    "Already told to this person (key [version]: summary). Do not raise these again unless the thing materially changed since, such as a new time, a new status or a worse outcome; a reminder is not a change. When you do speak, call note_surfaced for each item you raise, with the same key when it is the same thing.",
    ...lines,
  ].join("\n");
}
