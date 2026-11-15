import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

/** A pair of people has one conversation; the lower id is always `userAId`. */
export function directPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export interface DirectThreadRow {
  threadId: string;
  spaceId: string;
  userAId: string;
  userBId: string;
}

/** The other person of a conversation, or null when `userId` is not one of its two. */
export function directPartner(row: Pick<DirectThreadRow, "userAId" | "userBId">, userId: string) {
  if (row.userAId === userId) return row.userBId;
  if (row.userBId === userId) return row.userAId;
  return null;
}

/**
 * The conversation `threadId` for someone who is one of its two people. Anyone else, in the space
 * or not, gets the same refusal as for a conversation that does not exist.
 */
export async function requireDirectThread(
  prisma: Pick<PrismaClient, "directThread">,
  input: { spaceId: string; userId: string; threadId: string },
): Promise<DirectThreadRow & { partnerId: string }> {
  const row = await prisma.directThread.findFirst({
    where: { threadId: input.threadId, spaceId: input.spaceId },
  });
  const partnerId = row ? directPartner(row, input.userId) : null;
  if (!row || !partnerId) throw new IsolationError();
  return { ...row, partnerId };
}

/**
 * Opens the conversation between the actor and another member of the space, making it the first
 * time. Both must belong to the space, and a person has no conversation with themselves.
 */
export async function openDirectThread(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; withUserId: string },
): Promise<string> {
  if (input.userId === input.withUserId) throw new IsolationError();
  const pair = directPair(input.userId, input.withUserId);
  const existing = await prisma.directThread.findUnique({
    where: { spaceId_userAId_userBId: { spaceId: input.spaceId, ...pair } },
    select: { threadId: true },
  });
  if (existing) return existing.threadId;
  return prisma
    .$transaction(async (tx) => {
      const members = await tx.spaceMember.count({
        where: { spaceId: input.spaceId, userId: { in: [input.userId, input.withUserId] } },
      });
      if (members !== 2) throw new IsolationError();
      // A direct conversation is never offered to the wiki: nothing in it is the space's.
      const thread = await tx.thread.create({
        data: { spaceId: input.spaceId, userId: input.userId, wikiCapture: false },
        select: { id: true },
      });
      await tx.directThread.create({
        data: { threadId: thread.id, spaceId: input.spaceId, ...pair },
      });
      return thread.id;
    })
    .catch(async (error: unknown) => {
      // The other person opened it at the same moment.
      const raced = await prisma.directThread.findUnique({
        where: { spaceId_userAId_userBId: { spaceId: input.spaceId, ...pair } },
        select: { threadId: true },
      });
      if (raced) return raced.threadId;
      throw error;
    });
}

export interface DirectPerson {
  userId: string;
  name: string;
  image: string | null;
  threadId: string | null;
  unread: boolean;
}

/** The space's other members, each with the conversation the actor has with them, if any. */
export async function listDirectPeople(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<DirectPerson[]> {
  const [members, threads] = await Promise.all([
    prisma.spaceMember.findMany({
      where: { spaceId: input.spaceId, userId: { not: input.userId } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        userId: true,
        member: { select: { user: { select: { name: true, image: true } } } },
      },
    }),
    prisma.directThread.findMany({
      where: {
        spaceId: input.spaceId,
        OR: [{ userAId: input.userId }, { userBId: input.userId }],
      },
      select: { threadId: true, userAId: true, userBId: true },
    }),
  ]);
  const byPartner = new Map(
    threads.flatMap((row) => {
      const partner = directPartner(row, input.userId);
      return partner ? [[partner, row.threadId] as const] : [];
    }),
  );
  const reads = byPartner.size
    ? await prisma.threadMemberRead.findMany({
        where: { userId: input.userId, threadId: { in: [...byPartner.values()] } },
        select: { threadId: true, unread: true },
      })
    : [];
  const unread = new Set(reads.filter((row) => row.unread).map((row) => row.threadId));
  return members.map((row) => {
    const threadId = byPartner.get(row.userId) ?? null;
    return {
      userId: row.userId,
      name: row.member.user.name,
      image: row.member.user.image,
      threadId,
      unread: threadId !== null && unread.has(threadId),
    };
  });
}

/** The other person's unread dot goes on when someone writes; the author has just seen it. */
export async function markDirectUnreadFor(
  tx: Pick<PrismaClient, "threadMemberRead">,
  input: { threadId: string; spaceId: string; userId: string; seq: number },
): Promise<void> {
  await tx.threadMemberRead.upsert({
    where: { threadId_userId: { threadId: input.threadId, userId: input.userId } },
    create: {
      threadId: input.threadId,
      spaceId: input.spaceId,
      userId: input.userId,
      unread: true,
      lastReadSeq: input.seq - 1,
    },
    update: { unread: true },
  });
}

/** Marks the conversation read up to its latest message for this person. */
export async function markDirectRead(
  prisma: PrismaClient,
  input: { threadId: string; spaceId: string; userId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const thread = await tx.thread.findFirst({
      where: { id: input.threadId, spaceId: input.spaceId },
      select: { nextMessageSeq: true },
    });
    if (!thread) throw new IsolationError();
    await tx.threadMemberRead.upsert({
      where: { threadId_userId: { threadId: input.threadId, userId: input.userId } },
      create: {
        threadId: input.threadId,
        spaceId: input.spaceId,
        userId: input.userId,
        unread: false,
        lastReadSeq: thread.nextMessageSeq - 1,
      },
      update: { unread: false, lastReadSeq: thread.nextMessageSeq - 1 },
    });
  });
}
