import { createHash } from "node:crypto";
import type { MemoryMode, UserMemory, UserMemorySource, UserMemoryState } from "@corvo/contracts";
import { DEFAULT_MEMORY_MODE, MemoryModeSchema } from "@corvo/contracts";
import { cleanUserFact, USER_MEMORY_PROMPT_BYTES, userFactIsStale, userFactKey } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";

/** One person in one space: what their agents know about them is theirs alone. */
export type UserMemoryScope = { spaceId: string; userId: string };

export class UserMemoryNotFoundError extends Error {
  constructor() {
    super("There is no such memory.");
    this.name = "UserMemoryNotFoundError";
  }
}

/** A decision asked of a memory that is not in a state that allows it. */
export class UserMemoryStateError extends Error {
  constructor() {
    super("This memory cannot be changed that way now.");
    this.name = "UserMemoryStateError";
  }
}

export class UserMemoryTextError extends Error {
  constructor() {
    super("A memory is one short line.");
    this.name = "UserMemoryTextError";
  }
}

/** The most facts read at once, for the list and for search. */
const LIST_LIMIT = 500;

type Row = {
  id: string;
  text: string;
  state: string;
  source: string;
  botId: string | null;
  confirmedAt: Date;
  createdAt: Date;
};

/** A one-way digest of a fact, so a forgotten one is recognised without being kept readable. */
export function userMemoryFingerprint(scope: UserMemoryScope, text: string): string {
  return createHash("sha256")
    .update(`${scope.spaceId}\u0000${scope.userId}\u0000${userFactKey(text)}`)
    .digest("hex");
}

function viewOf(row: Row, now: Date = new Date()): UserMemory {
  return {
    id: row.id,
    text: row.text,
    state: row.state as UserMemoryState,
    source: row.source as UserMemorySource,
    createdAt: row.createdAt.toISOString(),
    stale: row.state === "saved" && userFactIsStale(row.confirmedAt, now),
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export type ProposedUserMemory =
  | { outcome: "created"; memory: UserMemory }
  /** The person already has it (saved or waiting); the same row is returned. */
  | { outcome: "known"; memory: UserMemory }
  /** The person forgot it before; it is not learned again. */
  | { outcome: "forgotten" };

/**
 * Adds a fact about a person. A fact they typed is saved at once and may bring back one they
 * forgot, since they are saying it again themselves; a fact an agent or the memory model found
 * is saved or waits for Save as `state` says, and never brings back a forgotten one.
 */
export async function proposeUserMemory(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  input: {
    text: string;
    source: UserMemorySource;
    state: "pending" | "saved";
    botId?: string;
    threadId?: string;
  },
): Promise<ProposedUserMemory> {
  const text = cleanUserFact(input.text);
  if (!text || !userFactKey(text)) throw new UserMemoryTextError();
  const fingerprint = userMemoryFingerprint(scope, text);
  const where = { spaceId_userId_fingerprint: { ...scope, fingerprint } };
  const existing = await prisma.userMemory.findUnique({ where });
  if (existing) {
    if (existing.state === "forgotten") {
      if (input.source !== "typed") return { outcome: "forgotten" };
      const restored = await prisma.userMemory.update({
        where: { id: existing.id },
        data: { state: "saved", text, source: "typed", confirmedAt: new Date() },
      });
      return { outcome: "created", memory: viewOf(restored) };
    }
    // Saying a fact again is seeing it again: a waiting one is saved when its person saves it.
    if (existing.state === "pending" && input.state === "saved") {
      const saved = await prisma.userMemory.update({
        where: { id: existing.id },
        data: { state: "saved", confirmedAt: new Date() },
      });
      return { outcome: "known", memory: viewOf(saved) };
    }
    return { outcome: "known", memory: viewOf(existing) };
  }
  try {
    const row = await prisma.userMemory.create({
      data: {
        ...scope,
        text,
        state: input.state,
        source: input.source,
        fingerprint,
        ...(input.botId ? { botId: input.botId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      },
    });
    return { outcome: "created", memory: viewOf(row) };
  } catch (error) {
    // Two answers at once: the other one wrote it first.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.userMemory.findUnique({ where });
    if (!winner) throw error;
    return winner.state === "forgotten"
      ? { outcome: "forgotten" }
      : { outcome: "known", memory: viewOf(winner) };
  }
}

/** A fact the person typed: saved at once, and it may bring back one they had forgotten. */
export async function addUserMemory(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  text: string,
): Promise<UserMemory> {
  const result = await proposeUserMemory(prisma, scope, {
    text,
    source: "typed",
    state: "saved",
  });
  // A typed fact is never refused for having been forgotten, so a memory always comes back.
  if (result.outcome === "forgotten") throw new UserMemoryStateError();
  return result.memory;
}

/** A person's memories, newest first; `state` narrows the list. */
export async function listUserMemories(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  options: { state?: UserMemoryState[] } = {},
): Promise<UserMemory[]> {
  const rows = await prisma.userMemory.findMany({
    where: { ...scope, ...(options.state?.length ? { state: { in: options.state } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
  });
  const now = new Date();
  return rows.map((row) => viewOf(row, now));
}

export async function getUserMemory(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  memoryId: string,
): Promise<UserMemory | null> {
  const row = await prisma.userMemory.findFirst({ where: { id: memoryId, ...scope } });
  return row ? viewOf(row) : null;
}

/**
 * The person's answer to one memory. Save and Discard are for a suggestion; Forget, and Keep ("still
 * true") for a saved fact; Undo of an automatic save is Forget. A discarded or forgotten fact is
 * kept as a fingerprint so it is not suggested again, until the person erases it for good.
 * Erasing returns null.
 */
export async function decideUserMemory(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  memoryId: string,
  decision: "save" | "discard" | "forget" | "keep" | "erase",
): Promise<UserMemory | null> {
  const row = await prisma.userMemory.findFirst({ where: { id: memoryId, ...scope } });
  if (!row) throw new UserMemoryNotFoundError();
  // A conditional write, so two answers at once (a phone and a screen) cannot both succeed.
  const move = async (from: string[], data: Prisma.UserMemoryUpdateManyMutationInput) => {
    const moved = await prisma.userMemory.updateMany({
      where: { id: row.id, ...scope, state: { in: from } },
      data,
    });
    if (moved.count !== 1) {
      const current = await prisma.userMemory.findFirst({ where: { id: row.id, ...scope } });
      // Answering what is already so is not an error: the card shows the state it is in.
      if (current) return viewOf(current);
      throw new UserMemoryNotFoundError();
    }
    return viewOf((await prisma.userMemory.findFirst({ where: { id: row.id, ...scope } }))!);
  };
  switch (decision) {
    case "save": {
      if (row.state === "saved") return viewOf(row);
      if (row.state !== "pending") throw new UserMemoryStateError();
      return move(["pending"], { state: "saved", confirmedAt: new Date() });
    }
    case "discard": {
      if (row.state === "forgotten") return viewOf(row);
      if (row.state !== "pending") throw new UserMemoryStateError();
      return move(["pending"], { state: "forgotten" });
    }
    case "forget":
      if (row.state === "forgotten") return viewOf(row);
      return move(["saved", "pending"], { state: "forgotten" });
    case "keep":
      if (row.state !== "saved") throw new UserMemoryStateError();
      return move(["saved"], { confirmedAt: new Date() });
    case "erase": {
      if (row.state !== "forgotten") throw new UserMemoryStateError();
      await prisma.userMemory.deleteMany({ where: { id: row.id, ...scope, state: "forgotten" } });
      return null;
    }
  }
}

/** Rewrites a fact the person keeps. Another fact that already says the same is not overwritten. */
export async function editUserMemory(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  memoryId: string,
  text: string,
): Promise<UserMemory> {
  const clean = cleanUserFact(text);
  if (!clean || !userFactKey(clean)) throw new UserMemoryTextError();
  const row = await prisma.userMemory.findFirst({ where: { id: memoryId, ...scope } });
  if (!row) throw new UserMemoryNotFoundError();
  if (row.state === "forgotten") throw new UserMemoryStateError();
  const fingerprint = userMemoryFingerprint(scope, clean);
  try {
    const updated = await prisma.userMemory.update({
      where: { id: row.id },
      data: { text: clean, fingerprint, confirmedAt: new Date() },
    });
    return viewOf(updated);
  } catch (error) {
    if (isUniqueViolation(error)) throw new UserMemoryStateError();
    throw error;
  }
}

/** The saved facts that match every word of `query` (the start of a word is enough), newest first. */
export async function searchUserMemories(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  query: string,
  limit = 10,
): Promise<string[]> {
  const words = userFactKey(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const rows = await prisma.userMemory.findMany({
    where: { ...scope, state: "saved" },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    select: { text: true },
  });
  return rows
    .map((row) => row.text)
    .filter((text) => {
      const tokens = userFactKey(text).split(" ");
      return words.every((word) => tokens.some((token) => token.startsWith(word)));
    })
    .slice(0, limit);
}

/** The text of a person's saved facts, newest-confirmed first. */
export async function savedUserFacts(
  prisma: PrismaClient,
  scope: UserMemoryScope,
): Promise<string[]> {
  const rows = await prisma.userMemory.findMany({
    where: { ...scope, state: "saved" },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    select: { text: true },
  });
  return rows.map((row) => row.text);
}

/**
 * What every agent of the person is told about them: as many saved facts as fit in the budget,
 * the most recently confirmed first, and a count of those left out (they stay findable by search).
 */
export function formatUserMemoryContext(
  facts: readonly string[],
  maxBytes: number = USER_MEMORY_PROMPT_BYTES,
): { lines: string[]; omitted: number } {
  const lines: string[] = [];
  let used = 0;
  for (const fact of facts) {
    const line = `- ${fact}`;
    const cost = Buffer.byteLength(line, "utf8") + 1;
    if (used + cost > maxBytes) break;
    lines.push(line);
    used += cost;
  }
  return { lines, omitted: facts.length - lines.length };
}

/** The mode a bot works in; a bot with none of its own asks first. */
export function memoryModeOf(bot: { memoryMode?: string | null }): MemoryMode {
  return MemoryModeSchema.safeParse(bot.memoryMode).data ?? DEFAULT_MEMORY_MODE;
}

export async function getMemoryLearning(
  prisma: PrismaClient,
  scope: UserMemoryScope,
): Promise<boolean> {
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: scope },
    select: { memoryLearning: true },
  });
  return member?.memoryLearning ?? false;
}

export async function setMemoryLearning(
  prisma: PrismaClient,
  scope: UserMemoryScope,
  learn: boolean,
): Promise<boolean> {
  await prisma.spaceMember.update({
    where: { spaceId_userId: scope },
    data: { memoryLearning: learn },
  });
  return learn;
}
