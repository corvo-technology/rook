import type { MissionId, MissionsView, NavPart } from "@corvo/contracts";
import { MISSION_IDS } from "@corvo/contracts";
import type { MissionFacts } from "@corvo/core";
import { completedMissions, MISSIONS } from "@corvo/core";
import type { PrismaClient } from "./client.js";

type Scope = { spaceId: string; userId: string };

/** Runs a user starts, as opposed to ones a routine, a webhook or another agent started. */
const PERSON_TRIGGERS = ["user", "messaging", "call_end"];

/** Prisma unique-constraint violation; anything else must still throw. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/** Begins the short navigation for a member; a member who already has it keeps it. */
export async function startShortNavigation(prisma: PrismaClient, scope: Scope): Promise<void> {
  await prisma.missionState.create({ data: scope }).catch((error: unknown) => {
    if (!isUniqueViolation(error)) throw error;
  });
}

async function facts(
  prisma: PrismaClient,
  scope: Scope,
  already: readonly MissionId[],
): Promise<MissionFacts> {
  const todo = (id: MissionId) => !already.includes(id);
  const [replied, connections, agents, routines, memories] = await Promise.all([
    todo("talk")
      ? prisma.run.count({
          where: { ...scope, status: "completed", trigger: { in: PERSON_TRIGGERS } },
          take: 1,
        })
      : 0,
    todo("connect")
      ? prisma.connection.count({ where: { ...scope, status: "connected" }, take: 1 })
      : 0,
    todo("second") ? prisma.bot.count({ where: { ...scope, archivedAt: null }, take: 2 }) : 0,
    todo("routine") ? prisma.routine.count({ where: scope, take: 1 }) : 0,
    todo("memory")
      ? prisma.memoryDocument.count({
          where: { ...scope, scope: { not: "wiki" }, revision: { gt: 1 } },
          take: 1,
        })
      : 0,
  ]);
  return {
    replied: replied > 0,
    decided: already.includes("decide"),
    connections,
    agents,
    routines,
    memories,
  };
}

/** The parts that already have content, so they show without a mission. */
async function partsWithContent(prisma: PrismaClient, scope: Scope): Promise<NavPart[]> {
  const [routine, workflow, artifact, memory, wiki, ticket] = await Promise.all([
    prisma.routine.count({ where: scope, take: 1 }),
    prisma.routine.count({ where: { ...scope, steps: { some: {} } }, take: 1 }),
    prisma.artifact.count({ where: scope, take: 1 }),
    prisma.memoryDocument.count({
      where: { ...scope, scope: { not: "wiki" }, revision: { gt: 1 } },
      take: 1,
    }),
    prisma.wikiChange.count({ where: { spaceId: scope.spaceId, state: "applied" }, take: 1 }),
    prisma.ticket.count({ where: { spaceId: scope.spaceId }, take: 1 }),
  ]);
  const has: [NavPart, number][] = [
    ["routines", routine],
    ["workflows", workflow],
    ["artifacts", artifact],
    ["memory", memory],
    ["wiki", wiki],
    ["board", ticket],
  ];
  return has.filter(([, count]) => count > 0).map(([part]) => part);
}

/** Missions in list order. */
function inListOrder(ids: readonly string[]): MissionId[] {
  return MISSION_IDS.filter((id) => ids.includes(id));
}

/**
 * Works out where a member is. Null when the member never started the short navigation, so the
 * full navigation shows and nothing is written.
 */
export async function readMissions(
  prisma: PrismaClient,
  scope: Scope,
): Promise<MissionsView | null> {
  const row = await prisma.missionState.findUnique({
    where: { spaceId_userId: scope },
  });
  if (!row) return null;
  const already = inListOrder(row.completed);
  let completed = already;
  const short = row.shownAllAt === null;
  if (short && already.length < MISSIONS.length) {
    const now = completedMissions(await facts(prisma, scope, already), already);
    if (now.length > already.length) completed = await latch(prisma, scope, now);
  }
  return {
    short,
    completed,
    has: short ? await partsWithContent(prisma, scope) : [],
    seen: row.seenParts as NavPart[],
  };
}

/**
 * Adds missions to the completed list in one statement that skips what is already there, so
 * concurrent readers cannot duplicate or lose an entry. Returns the list as stored.
 */
async function latch(
  prisma: PrismaClient,
  scope: Scope,
  ids: readonly MissionId[],
): Promise<MissionId[]> {
  const rows = await prisma.$queryRaw<{ completed: string[] }[]>`
    UPDATE "mission_states"
    SET "completed" = "completed" || ARRAY(
      SELECT DISTINCT id FROM unnest(${[...ids]}::text[]) AS id WHERE id <> ALL("completed")
    )
    WHERE "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
    RETURNING "completed"`;
  return inListOrder(rows[0]?.completed ?? ids);
}

/** Records a mission the facts cannot show later, such as an answered request. */
export async function completeMission(
  prisma: PrismaClient,
  scope: Scope,
  id: MissionId,
): Promise<void> {
  await latch(prisma, scope, [id]);
}

/** Records that the member opened a part a mission brought. */
export async function markPartSeen(
  prisma: PrismaClient,
  scope: Scope,
  part: NavPart,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "mission_states"
    SET "seenParts" = array_append("seenParts", ${part})
    WHERE "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
      AND ${part} <> ALL("seenParts")`;
}

/** Ends the short navigation for good; the first time it ended is kept. */
export async function showAllNavigation(prisma: PrismaClient, scope: Scope): Promise<void> {
  await prisma.missionState.updateMany({
    where: { ...scope, shownAllAt: null },
    data: { shownAllAt: new Date() },
  });
}
