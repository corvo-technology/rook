import type { WikiImport } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import type { WikiScope } from "./wiki.js";

/** A finished import stays listed this long; a failed one is dismissed by hand or ages out. */
const FAILED_KEPT_MS = 24 * 60 * 60 * 1000;
/** A read that has not moved for this long is given up on: the worker that held it is gone. */
export const WIKI_IMPORT_STALE_MS = 30 * 60 * 1000;

type Row = {
  id: string;
  name: string;
  state: string;
  parts: number;
  readParts: number;
  error: string | null;
};

const view = (row: Row): WikiImport => ({
  id: row.id,
  name: row.name,
  state: row.state === "failed" ? "failed" : "reading",
  parts: row.parts,
  readParts: row.readParts,
  ...(row.error ? { error: row.error } : {}),
});

/** A file about to be read into the wiki. */
export async function createWikiImport(
  db: PrismaClient,
  scope: WikiScope,
  name: string,
): Promise<{ id: string }> {
  const row = await db.wikiImport.create({
    data: { spaceId: scope.spaceId, userId: scope.userId, name },
    select: { id: true },
  });
  return row;
}

export const getWikiImport = (db: PrismaClient, id: string) =>
  db.wikiImport.findUnique({
    where: { id },
    select: { id: true, spaceId: true, userId: true, name: true, state: true },
  });

/** How far a read has got: the parts the file was cut into and the parts read so far. */
export async function progressWikiImport(
  db: PrismaClient,
  id: string,
  progress: { parts?: number; readParts?: number },
): Promise<void> {
  await db.wikiImport.updateMany({ where: { id, state: "reading" }, data: progress });
}

export async function finishWikiImport(
  db: PrismaClient,
  id: string,
  outcome: { error: string } | undefined,
): Promise<void> {
  // Reading ended well: nothing is left to show, so the row goes.
  if (!outcome) await db.wikiImport.deleteMany({ where: { id } });
  else
    await db.wikiImport.updateMany({
      where: { id },
      data: { state: "failed", error: outcome.error },
    });
}

/** What is being read or failed lately, for the Wiki screen; the oldest first. */
export async function listWikiImports(
  db: PrismaClient,
  scope: WikiScope,
  now: Date = new Date(),
): Promise<WikiImport[]> {
  const rows = await db.wikiImport.findMany({
    where: {
      spaceId: scope.spaceId,
      OR: [
        { state: "reading", updatedAt: { gt: new Date(now.getTime() - WIKI_IMPORT_STALE_MS) } },
        { state: "failed", updatedAt: { gt: new Date(now.getTime() - FAILED_KEPT_MS) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true, name: true, state: true, parts: true, readParts: true, error: true },
  });
  return rows.map(view);
}

export async function dismissWikiImport(
  db: PrismaClient,
  scope: WikiScope,
  id: string,
): Promise<void> {
  await db.wikiImport.deleteMany({ where: { id, spaceId: scope.spaceId, state: "failed" } });
}
