import type { BusinessAnswer, HomeChecklist, OnboardingAnswers, WorkArea } from "@corvo/contracts";
import { BusinessAnswerSchema, WorkArea as WorkAreaSchema } from "@corvo/contracts";
import { businessCopy, homeChecklist } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { CHIEF_SPAWN_KEY } from "./starter-team.js";
import { writeWikiPage } from "./wiki.js";

type Scope = { spaceId: string; userId: string };

/** Only the member's own keys: callers pass a whole actor, which Prisma rejects inside a `where`. */
const memberWhere = ({ spaceId, userId }: Scope): Scope => ({ spaceId, userId });

/** The wiki page text for a business answer: its sentence first, which the wiki index shows. */
export function businessWikiBody(answer: BusinessAnswer, locale = "en"): string {
  const copy = businessCopy(locale);
  const kind = copy.kinds[answer.kind];
  const summary = answer.summary.trim();
  const sentence = summary ? (/[.!?。]$/.test(summary) ? summary : `${summary}.`) : `${kind}.`;
  return `---\ntype: ${copy.type}\n---\n${sentence}\n\n${copy.line(kind)}\n`;
}

/** Saves what the workspace does as shared knowledge, and as the answer the rail shows. */
export async function saveBusinessAnswer(
  prisma: PrismaClient,
  scope: Scope,
  answer: BusinessAnswer,
  locale = "en",
): Promise<void> {
  await writeWikiPage(prisma, scope, {
    title: businessCopy(locale).title,
    body: businessWikiBody(answer, locale),
  });
  const row = await prisma.onboardingProgress.findUnique({ where: { userId: scope.userId } });
  const answers = { ...((row?.answers as Record<string, unknown> | null) ?? {}), business: answer };
  await prisma.onboardingProgress.upsert({
    where: { userId: scope.userId },
    create: { userId: scope.userId, answers },
    update: { answers },
  });
}

export async function saveWorkAreas(
  prisma: PrismaClient,
  scope: Scope,
  areas: readonly WorkArea[],
): Promise<void> {
  await prisma.spaceMember.updateMany({
    where: memberWhere(scope),
    data: { areas: [...new Set(areas)] },
  });
}

/** What first-run onboarding knows about this person and their workspace. */
export async function readOnboardingAnswers(
  prisma: PrismaClient,
  scope: Scope,
): Promise<OnboardingAnswers> {
  const [progress, member, space] = await Promise.all([
    prisma.onboardingProgress.findUnique({ where: { userId: scope.userId } }),
    prisma.spaceMember.findFirst({ where: memberWhere(scope), select: { areas: true } }),
    prisma.space.findUnique({ where: { id: scope.spaceId }, select: { logo: true } }),
  ]);
  const business = BusinessAnswerSchema.safeParse(
    (progress?.answers as { business?: unknown } | null)?.business,
  );
  return {
    business: business.success ? business.data : null,
    areas: (member?.areas ?? []).filter(
      (area): area is WorkArea => WorkAreaSchema.safeParse(area).success,
    ),
    logo: space?.logo ?? null,
  };
}

/** Runs a person starts, as opposed to ones a routine, a webhook or another agent started. */
const PERSON_TRIGGERS = ["user", "messaging", "call_end"];

/** The getting-started list for a member, or null once every item is done. */
export async function readHomeChecklist(
  prisma: PrismaClient,
  scope: Scope,
): Promise<HomeChecklist | null> {
  const [talked, connected, routine, members, invitations, chief] = await Promise.all([
    prisma.run.count({
      where: { ...memberWhere(scope), trigger: { in: PERSON_TRIGGERS } },
      take: 1,
    }),
    prisma.connection.count({ where: { ...memberWhere(scope), status: "connected" }, take: 1 }),
    prisma.routine.count({ where: { spaceId: scope.spaceId }, take: 1 }),
    prisma.spaceMember.count({ where: { spaceId: scope.spaceId }, take: 2 }),
    prisma.spaceInvitation.count({ where: { spaceId: scope.spaceId }, take: 1 }),
    prisma.bot.findFirst({
      where: { ...memberWhere(scope), spawnKey: CHIEF_SPAWN_KEY, archivedAt: null },
      select: { id: true },
    }),
  ]);
  const list = homeChecklist({
    talked: talked > 0,
    connected: connected > 0,
    hasRoutine: routine > 0,
    invited: members > 1 || invitations > 0,
  });
  return list ? { ...list, chiefId: chief?.id ?? null } : null;
}
