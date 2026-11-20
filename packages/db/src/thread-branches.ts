import type { Prisma, PrismaClient } from "./client.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** The slice of a branch the visible line is worked out from. */
export interface BranchRow {
  id: string;
  parentBranchId: string | null;
  forkSeq: number;
  createdAt: Date;
}

/** One stretch of the visible line: a branch's own messages, up to `maxSeq` when later ones left it. */
export interface BranchSegment {
  branchId: string | null;
  maxSeq: number | null;
}

/** Where a message sits among the versions of one point in the conversation. */
export interface MessageVariants {
  /** Zero-based place of the version on screen. */
  index: number;
  count: number;
  /** The branch of each version in order; null is the original line. */
  branchIds: (string | null)[];
}

/** The branches the active one is built from, newest first, ending at the original line. */
export function branchSegments(
  branches: readonly BranchRow[],
  activeBranchId: string | null,
): BranchSegment[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const segments: BranchSegment[] = [];
  let current = activeBranchId;
  let bound: number | null = null;
  const seen = new Set<string>();
  while (current !== null) {
    const branch = byId.get(current);
    // A branch that is gone (or a loop) leaves the original line, never a broken conversation.
    if (!branch || seen.has(current)) break;
    seen.add(current);
    segments.push({ branchId: current, maxSeq: bound });
    bound = bound === null ? branch.forkSeq : Math.min(bound, branch.forkSeq);
    current = branch.parentBranchId;
  }
  segments.push({ branchId: null, maxSeq: bound });
  return segments;
}

/** The filter that keeps the messages of the visible line; `{}` when the thread never branched. */
export function visibleMessageFilter(
  segments: readonly BranchSegment[],
  hasBranches: boolean,
): Prisma.MessageWhereInput {
  if (!hasBranches) return {};
  return {
    OR: segments.map((segment) => ({
      branchId: segment.branchId,
      ...(segment.maxSeq === null ? {} : { seq: { lte: segment.maxSeq } }),
    })),
  };
}

/** What a thread read needs to carry for the version on screen to be worked out without another query. */
export const threadBranchInclude = {
  branches: {
    select: { id: true, parentBranchId: true, forkSeq: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ThreadInclude;

/** The filter for the version on screen, from a thread read with `threadBranchInclude`. */
export function visibleFilterOf(thread: {
  activeBranchId?: string | null;
  branches?: readonly BranchRow[];
}): Prisma.MessageWhereInput {
  const branches = thread.branches ?? [];
  return visibleMessageFilter(
    branchSegments(branches, thread.activeBranchId ?? null),
    branches.length > 0,
  );
}

export async function loadBranchState(db: Db, threadId: string) {
  const thread = await db.thread.findUnique({
    where: { id: threadId },
    select: { activeBranchId: true, ...threadBranchInclude },
  });
  const branches = thread?.branches ?? [];
  const activeBranchId = thread?.activeBranchId ?? null;
  return { branches, activeBranchId, segments: branchSegments(branches, activeBranchId) };
}

/** Which messages of a thread are on screen and in the agent's context: the active line only. */
export async function visibleMessagesWhere(
  db: Db,
  threadId: string,
): Promise<Prisma.MessageWhereInput> {
  const state = await loadBranchState(db, threadId);
  return visibleMessageFilter(state.segments, state.branches.length > 0);
}

/**
 * For each point where the conversation was regenerated or edited, the message that opens the
 * version on screen, with the versions it can be swapped for. Keyed by message id.
 */
export async function messageVariantsByMessage(
  db: Db,
  threadId: string,
): Promise<Map<string, MessageVariants>> {
  const state = await loadBranchState(db, threadId);
  const found = new Map<string, MessageVariants>();
  if (state.branches.length === 0) return found;
  const visible = visibleMessageFilter(state.segments, true);
  const { segments, branches } = state;
  for (const [position, segment] of segments.entries()) {
    const children = branches.filter((branch) => branch.parentBranchId === segment.branchId);
    const next = segments[position - 1]?.branchId ?? null;
    const forks = [...new Set(children.map((branch) => branch.forkSeq))];
    for (const forkSeq of forks) {
      if (segment.maxSeq !== null && forkSeq > segment.maxSeq) continue;
      const siblings = children.filter((branch) => branch.forkSeq === forkSeq);
      const branchIds = [segment.branchId, ...siblings.map((branch) => branch.id)];
      const onScreen = siblings.find((branch) => branch.id === next)?.id ?? segment.branchId;
      const anchor = await db.message.findFirst({
        where: { threadId, AND: [visible], seq: { gt: forkSeq }, role: { not: "system" } },
        orderBy: { seq: "asc" },
        select: { id: true },
      });
      if (!anchor) continue;
      found.set(anchor.id, {
        index: branchIds.indexOf(onScreen),
        count: branchIds.length,
        branchIds,
      });
    }
  }
  return found;
}

export class BranchError extends Error {
  constructor(
    readonly code: "not_found" | "compacted",
    message: string,
  ) {
    super(message);
    this.name = "BranchError";
  }
}
