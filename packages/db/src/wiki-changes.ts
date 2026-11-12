import type {
  WikiApplyAllResult,
  WikiChangePage,
  WikiChangeState,
  WikiSettings,
} from "@corvo/contracts";
import { applyCuratorOp, type CuratorOp, wikiCanonicalTitle, wikiSlug } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import {
  readWikiPage,
  removeWikiPage,
  restoreWikiRevision,
  WikiConflictError,
  WikiNotFoundError,
  type WikiScope,
  WikiTitleError,
  writeWikiPage,
} from "./wiki.js";

/** A decision asked of a change that is not in a state that allows it. */
export class WikiChangeStateError extends Error {
  constructor() {
    super("This change cannot be decided now.");
    this.name = "WikiChangeStateError";
  }
}

/** A change as the routes need it: the quoted source is for them to show or hide. */
/** What one operation would write, in words a person can read before approving it. */
export type WikiChangeEdit = {
  title: string;
  op: "create" | "append" | "replace";
  section?: string;
  removed?: string;
  added: string;
};

export type WikiChangeRecord = {
  id: string;
  state: WikiChangeState;
  reason: string;
  pages: WikiChangePage[];
  edits: WikiChangeEdit[];
  createdAt: Date;
  anchorThreadId: string | null;
  anchorMessageId: string | null;
  sourceTitle: string;
  sourceText: string;
  /** The owner of the conversation the source came from: the only person shown its text. */
  sourceUserId: string;
  /** Found by the review of the pages themselves, so it says nothing private. */
  review: boolean;
};

type Revisions = Record<string, number>;

const DEFAULT_SETTINGS: WikiSettings = { capture: true, edits: "approve" };
const LIST_LIMIT = 100;

type Row = {
  id: string;
  state: string;
  reason: string;
  ops: unknown;
  baseRevisions: unknown;
  appliedRevisions: unknown;
  createdAt: Date;
  anchorThreadId: string | null;
  anchorMessageId: string | null;
  source: {
    title: string;
    text: string;
    userId: string;
    threadId: string | null;
    origin: string;
  };
};

const opsOf = (row: Row) => row.ops as CuratorOp[];
const revisionsOf = (value: unknown): Revisions => (value ?? {}) as Revisions;

/** The operations by page, in the order the pages first appear. */
function byPage(ops: CuratorOp[]): { title: string; slug: string; ops: CuratorOp[] }[] {
  const pages = new Map<string, { title: string; slug: string; ops: CuratorOp[] }>();
  for (const op of ops) {
    const slug = wikiSlug(wikiCanonicalTitle(op.page));
    const page = pages.get(slug) ?? { title: wikiCanonicalTitle(op.page), slug, ops: [] };
    page.ops.push(op);
    pages.set(slug, page);
  }
  return [...pages.values()];
}

function previewOf(ops: CuratorOp[]): WikiChangeEdit[] {
  return ops.map((op) => {
    if (op.op === "create")
      return { title: op.page, op: "create", added: applyCuratorOp("", op) ?? op.body };
    if (op.op === "append")
      return {
        title: op.page,
        op: "append",
        ...(op.section ? { section: op.section } : {}),
        added: op.text,
      };
    return { title: op.page, op: "replace", removed: op.old, added: op.new };
  });
}

function recordOf(row: Row): WikiChangeRecord {
  const base = revisionsOf(row.baseRevisions);
  return {
    id: row.id,
    state: row.state as WikiChangeState,
    reason: row.reason,
    pages: byPage(opsOf(row)).map((page) => ({
      title: page.title,
      op:
        base[page.title] === 0
          ? "create"
          : page.ops.some((op) => op.op === "replace")
            ? "replace"
            : "append",
    })),
    edits: previewOf(opsOf(row)),
    createdAt: row.createdAt,
    anchorThreadId: row.anchorThreadId,
    anchorMessageId: row.anchorMessageId,
    sourceTitle: row.source.title,
    sourceText: row.source.text,
    sourceUserId: row.source.userId,
    review: row.source.origin === "review",
  };
}

const INCLUDE = {
  source: { select: { title: true, text: true, userId: true, threadId: true, origin: true } },
};

/**
 * The operations that can still be applied to the pages as they stand now, and the revision each
 * page was at. A `create` of a page that exists, an `append` or `replace` of one that does not, and
 * a `replace` of a passage that is gone are left out: the change keeps only what it can do.
 */
async function plan(db: PrismaClient, scope: WikiScope, ops: CuratorOp[]) {
  const pages = new Map<string, { title: string; base: number; text: string | null }>();
  const kept: CuratorOp[] = [];
  for (const op of ops) {
    const slug = wikiSlug(wikiCanonicalTitle(op.page));
    let page = pages.get(slug);
    if (!page) {
      const current = await readWikiPage(db, scope, op.page);
      page = current
        ? { title: current.title, base: current.revision, text: current.body }
        : { title: wikiCanonicalTitle(op.page), base: 0, text: null };
      pages.set(slug, page);
    }
    if (op.op === "create") {
      if (page.text !== null) continue;
    } else if (page.text === null) continue;
    const next = applyCuratorOp(page.text ?? "", op);
    if (next === null) continue;
    page.text = next;
    kept.push({ ...op, page: page.title });
  }
  const base: Revisions = {};
  for (const page of pages.values())
    if (kept.some((op) => op.page === page.title)) base[page.title] = page.base;
  return { kept, base };
}

/**
 * Writes the pages of a change that are not written yet, each against the revision it was planned
 * on. A page that moved on stops the rest: what was written is kept so it can be undone.
 */
async function applyPages(
  db: PrismaClient,
  scope: WikiScope,
  row: Row,
  only?: (title: string, isNew: boolean) => boolean,
): Promise<{ applied: Revisions; conflict: boolean }> {
  const base = revisionsOf(row.baseRevisions);
  const applied = { ...revisionsOf(row.appliedRevisions) };
  for (const page of byPage(opsOf(row))) {
    if (applied[page.title] !== undefined) continue;
    const isNew = base[page.title] === 0;
    if (only && !only(page.title, isNew)) continue;
    try {
      const current = isNew ? undefined : await readWikiPage(db, scope, page.title);
      if (!isNew && current?.revision !== base[page.title]) return { applied, conflict: true };
      let text = current?.body ?? "";
      for (const op of page.ops) {
        const next = applyCuratorOp(text, op);
        if (next === null) return { applied, conflict: true };
        text = next;
      }
      const written = await writeWikiPage(db, scope, {
        title: page.title,
        body: text,
        expectedRevision: base[page.title],
        sourceThreadId: row.source.threadId ?? undefined,
      });
      applied[page.title] = written.revision;
    } catch (error) {
      if (error instanceof WikiConflictError || error instanceof WikiTitleError)
        return { applied, conflict: true };
      throw error;
    }
  }
  return { applied, conflict: false };
}

const isUnique = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

/**
 * Keeps a stretch of conversation, or a message kept on purpose, as a source and the operations
 * drawn from it as a change. New pages are written at once; an edit goes in at once only when the
 * Space says so, and otherwise waits. Null when the stretch was kept before, or nothing is left to do.
 */
export async function createWikiChange(
  db: PrismaClient,
  scope: WikiScope,
  input: {
    source: {
      origin: "conversation" | "message" | "note" | "review";
      title: string;
      text: string;
      threadId?: string;
      fromSeq?: number;
      toSeq?: number;
      messageId?: string;
    };
    ops: CuratorOp[];
    reason: string;
    anchor: { threadId?: string; messageId?: string };
    edits: WikiSettings["edits"];
  },
): Promise<WikiChangeRecord | null> {
  const { kept, base } = await plan(db, scope, input.ops);
  if (!kept.length) return null;
  let created: Row;
  try {
    created = (await db.$transaction(async (tx) => {
      const source = await tx.wikiSource.create({
        data: { spaceId: scope.spaceId, userId: scope.userId, ...input.source },
      });
      return tx.wikiChange.create({
        data: {
          spaceId: scope.spaceId,
          userId: scope.userId,
          sourceId: source.id,
          ops: kept,
          reason: input.reason,
          baseRevisions: base,
          anchorThreadId: input.anchor.threadId,
          anchorMessageId: input.anchor.messageId,
        },
        include: INCLUDE,
      });
    })) as Row;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
  const { applied, conflict } = await applyPages(
    db,
    scope,
    created,
    (_title, isNew) => isNew || input.edits === "auto",
  );
  const all = byPage(kept).every((page) => applied[page.title] !== undefined);
  const row = (await db.wikiChange.update({
    where: { id: created.id },
    data: {
      appliedRevisions: applied,
      state: conflict ? "conflict" : all ? "applied" : "pending",
    },
    include: INCLUDE,
  })) as Row;
  return recordOf(row);
}

async function load(db: PrismaClient, scope: WikiScope, changeId: string): Promise<Row> {
  const row = (await db.wikiChange.findFirst({
    where: { id: changeId, spaceId: scope.spaceId },
    include: INCLUDE,
  })) as Row | null;
  if (!row) throw new WikiNotFoundError();
  return row;
}

/** Moves a change to the state a decision reaches, only from the state it was read in. */
async function settle(
  db: PrismaClient,
  scope: WikiScope,
  row: Row,
  data: { state: WikiChangeState; appliedRevisions?: Revisions },
): Promise<WikiChangeRecord> {
  const { count } = await db.wikiChange.updateMany({
    where: { id: row.id, spaceId: scope.spaceId, state: row.state },
    data: { ...data, claimedAt: null, decidedByUserId: scope.userId, decidedAt: new Date() },
  });
  if (count !== 1) throw new WikiChangeStateError();
  return recordOf(await load(db, scope, row.id));
}

/** A claim older than this is a decision that stopped half way, and no longer blocks the change. */
const CLAIM_STALE_MS = 2 * 60_000;

/**
 * Takes a change for one answer at a time, before any page is written, so two answers (two members,
 * a phone and a screen, an approval and a refusal) cannot both write pages or settle it.
 */
async function claim(db: PrismaClient, scope: WikiScope, row: Row): Promise<void> {
  const { count } = await db.wikiChange.updateMany({
    where: {
      id: row.id,
      spaceId: scope.spaceId,
      state: row.state,
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } }],
    },
    data: { claimedAt: new Date() },
  });
  if (count !== 1) throw new WikiChangeStateError();
}

const release = (db: PrismaClient, row: Row) =>
  db.wikiChange
    .updateMany({ where: { id: row.id }, data: { claimedAt: null } })
    .catch(() => undefined);

/**
 * Puts each written page back to what it said before the change, and only a page nobody has
 * edited since: the page is written or deleted at the revision the change produced. Returns
 * whether every page was put back.
 */
async function revertWrittenPages(db: PrismaClient, scope: WikiScope, row: Row): Promise<boolean> {
  const applied = revisionsOf(row.appliedRevisions);
  const base = revisionsOf(row.baseRevisions);
  let all = true;
  for (const title of Object.keys(applied)) {
    try {
      if (base[title] === 0) {
        if (!(await removeWikiPage(db, scope, title, { expectedRevision: applied[title] })))
          all = false;
      } else {
        await restoreWikiRevision(db, scope, title, base[title]!, {
          expectedRevision: applied[title],
        });
      }
    } catch (error) {
      if (!(error instanceof WikiConflictError || error instanceof WikiNotFoundError)) throw error;
      all = false;
    }
  }
  return all;
}

/**
 * The people's answer to a change. Approving writes the pages not written yet; undoing puts back
 * what each page said before, but only for pages nobody has edited since the change wrote them.
 */
export async function decideWikiChange(
  db: PrismaClient,
  scope: WikiScope,
  changeId: string,
  decision: "apply" | "refuse" | "undo",
): Promise<WikiChangeRecord> {
  const row = await load(db, scope, changeId);
  const state = row.state as WikiChangeState;
  const applied = revisionsOf(row.appliedRevisions);
  if (decision !== "undo" && state !== "pending") throw new WikiChangeStateError();
  if (decision === "undo" && (state === "undone" || !Object.keys(applied).length))
    throw new WikiChangeStateError();
  await claim(db, scope, row);
  try {
    if (decision === "refuse") {
      // A refused package keeps nothing: what it already wrote is taken back, unless it was edited.
      await revertWrittenPages(db, scope, row);
      return await settle(db, scope, row, { state: "refused" });
    }
    if (decision === "apply") {
      const result = await applyPages(db, scope, row);
      return await settle(db, scope, row, {
        state: result.conflict ? "conflict" : "applied",
        appliedRevisions: result.applied,
      });
    }
    for (const title of Object.keys(applied)) {
      const current = await readWikiPage(db, scope, title);
      if (current?.revision !== applied[title])
        return await settle(db, scope, row, { state: "conflict" });
    }
    return await settle(db, scope, row, {
      state: (await revertWrittenPages(db, scope, row)) ? "undone" : "conflict",
    });
  } catch (error) {
    await release(db, row);
    throw error;
  }
}

/**
 * Applies every waiting change, oldest first. A change whose page moved ends `conflict` and the
 * rest still apply; one another answer has claimed or settled meanwhile is left to that answer.
 */
export async function applyAllWikiChanges(
  db: PrismaClient,
  scope: WikiScope,
): Promise<WikiApplyAllResult> {
  const waiting = await db.wikiChange.findMany({
    // What the review found is looked at one finding at a time, never approved in bulk.
    where: { spaceId: scope.spaceId, state: "pending", source: { origin: { not: "review" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const result: WikiApplyAllResult = { applied: 0, conflicts: 0 };
  for (const { id } of waiting) {
    try {
      const change = await decideWikiChange(db, scope, id, "apply");
      if (change.state === "applied") result.applied += 1;
      else if (change.state === "conflict") result.conflicts += 1;
    } catch (error) {
      if (!(error instanceof WikiChangeStateError)) throw error;
    }
  }
  return result;
}

export async function listWikiChanges(
  db: PrismaClient,
  scope: WikiScope,
  filter: { state?: WikiChangeState[] } = {},
): Promise<WikiChangeRecord[]> {
  const rows = (await db.wikiChange.findMany({
    where: {
      spaceId: scope.spaceId,
      ...(filter.state?.length ? { state: { in: filter.state } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    include: INCLUDE,
  })) as Row[];
  return rows.map(recordOf);
}

export async function getWikiChange(
  db: PrismaClient,
  scope: WikiScope,
  changeId: string,
): Promise<WikiChangeRecord | undefined> {
  const row = (await db.wikiChange.findFirst({
    where: { id: changeId, spaceId: scope.spaceId },
    include: INCLUDE,
  })) as Row | null;
  return row ? recordOf(row) : undefined;
}

export async function getWikiSettings(db: PrismaClient, spaceId: string): Promise<WikiSettings> {
  const row = await db.wikiSettings.findUnique({ where: { spaceId } });
  return row
    ? { capture: row.capture, edits: row.edits as WikiSettings["edits"] }
    : DEFAULT_SETTINGS;
}

export async function setWikiSettings(
  db: PrismaClient,
  spaceId: string,
  patch: Partial<WikiSettings>,
): Promise<WikiSettings> {
  const row = await db.wikiSettings.upsert({
    where: { spaceId },
    create: { spaceId, ...patch },
    update: patch,
  });
  return { capture: row.capture, edits: row.edits as WikiSettings["edits"] };
}

/** One conversation's switch; false when the conversation is not this person's in this Space. */
export async function setThreadWikiCapture(
  db: PrismaClient,
  thread: { threadId: string; spaceId: string; userId: string },
  capture: boolean | null,
): Promise<boolean> {
  const { count } = await db.thread.updateMany({
    where: { id: thread.threadId, spaceId: thread.spaceId, userId: thread.userId },
    data: { wikiCapture: capture },
  });
  return count === 1;
}

/** Moves the cursor of what the curator has read, only from where it was; false when it moved. */
export async function advanceWikiCursor(
  db: PrismaClient,
  threadId: string,
  from: number | null,
  to: number,
): Promise<boolean> {
  const { count } = await db.thread.updateMany({
    where: { id: threadId, wikiCuratedUpToSeq: from },
    data: { wikiCuratedUpToSeq: to },
  });
  return count === 1;
}

/**
 * What trying a conflicting change again starts from; undefined when it cannot be tried again.
 * Only a change that wrote nothing can be: one that wrote pages is put right by undoing it.
 */
export async function wikiChangeToRetry(
  db: PrismaClient,
  scope: WikiScope,
  changeId: string,
): Promise<{ ops: CuratorOp[]; sourceText: string } | undefined> {
  const row = (await db.wikiChange.findFirst({
    where: { id: changeId, spaceId: scope.spaceId, state: "conflict" },
    include: INCLUDE,
  })) as Row | null;
  if (!row || Object.keys(revisionsOf(row.appliedRevisions)).length) return undefined;
  return { ops: opsOf(row), sourceText: row.source.text };
}

/**
 * Puts a change that hit a moved page back to waiting, with operations written again against the
 * pages as they stand now, only from the conflict it was read in. Null when none of the operations
 * still apply or another answer got there first.
 */
export async function reopenWikiChange(
  db: PrismaClient,
  scope: WikiScope,
  changeId: string,
  ops: CuratorOp[],
): Promise<WikiChangeRecord | null> {
  if (!(await wikiChangeToRetry(db, scope, changeId))) return null;
  const { kept, base } = await plan(db, scope, ops);
  if (!kept.length) return null;
  const { count } = await db.wikiChange.updateMany({
    where: { id: changeId, spaceId: scope.spaceId, state: "conflict" },
    data: {
      ops: kept,
      baseRevisions: base,
      appliedRevisions: {},
      state: "pending",
      decidedAt: null,
      decidedByUserId: null,
    },
  });
  return count === 1 ? ((await getWikiChange(db, scope, changeId)) ?? null) : null;
}

/** The titles of review findings that wait or were refused, so a review does not repeat them. */
export async function knownWikiFindingTitles(
  db: PrismaClient,
  scope: WikiScope,
): Promise<string[]> {
  const rows = await db.wikiChange.findMany({
    where: {
      spaceId: scope.spaceId,
      state: { in: ["pending", "refused"] },
      source: { origin: "review" },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { source: { select: { title: true } } },
  });
  return rows.map((row) => row.source.title);
}

const REVIEW_EVERY_MS = 7 * 24 * 3_600_000;

/** Notes that the Space's pages have just been reviewed. */
export async function markWikiReviewed(
  db: PrismaClient,
  spaceId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.wikiSettings.upsert({
    where: { spaceId },
    create: { spaceId, reviewedAt: now },
    update: { reviewedAt: now },
  });
}

/** Whether a week has passed since the Space's last review. */
export async function wikiReviewDue(
  db: PrismaClient,
  spaceId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const row = await db.wikiSettings.findUnique({
    where: { spaceId },
    select: { reviewedAt: true },
  });
  return !row?.reviewedAt || row.reviewedAt.getTime() < now.getTime() - REVIEW_EVERY_MS;
}
