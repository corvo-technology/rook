import type { JobPublisher } from "@corvo/adapter-kit";
import { runContinueJob } from "@corvo/adapter-kit";
import type { AgentCatalogEntry, AgentCatalogLocale, StarterRoutine } from "@corvo/contracts";
import { TimeZoneSchema } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { ScheduleToolDeps } from "./schedule-tools.js";
import { createScheduleFromTool } from "./schedule-tools.js";

/** A starter routine as the person's agent set it up, in words the announcement can use. */
export type StarterRoutineSetup = {
  agent: string;
  name: string;
  /** For example "At 09:00, only on Monday". */
  schedule: string;
  nextRun: string | null;
  timezone: string;
  /** False when the person has no saved timezone and UTC was used instead. */
  timezoneKnown: boolean;
};

/**
 * Create the routines an agent starts with, owned by that agent, in the person's own
 * timezone. Safe to repeat: a routine whose name the agent already has active is left alone, and
 * only newly created ones are returned. Never throws; a routine that cannot be created is logged.
 */
export async function createStarterRoutines(
  deps: ScheduleToolDeps,
  input: {
    /** A catalog agent, or any agent with a slug and routines of its own, such as Rook. */
    entry: Pick<AgentCatalogEntry, "slug"> & { routines?: readonly StarterRoutine[] };
    locale: AgentCatalogLocale;
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string | null;
    botName: string;
  },
): Promise<StarterRoutineSetup[]> {
  const { entry, locale } = input;
  if (!entry.routines?.length || !input.threadId) return [];
  const user = await deps.prisma.user.findUnique({
    where: { id: input.userId },
    select: { timezone: true },
  });
  const known = TimeZoneSchema.safeParse(user?.timezone).success;
  const timezone = known && user?.timezone ? user.timezone : "UTC";
  const made: StarterRoutineSetup[] = [];
  for (const routine of entry.routines) {
    try {
      const created = await createScheduleFromTool(deps, {
        spaceId: input.spaceId,
        botId: input.botId,
        userId: input.userId,
        threadId: input.threadId,
        name: routine.name[locale],
        prompt: routine.prompt[locale],
        timezone,
        schedule: { cron: routine.cron },
      });
      if ("error" in created) {
        // Most often the agent already has this routine: that is the expected repeat.
        getLogger().info("starter routine not created", { slug: entry.slug, key: routine.key });
        continue;
      }
      made.push({
        agent: input.botName,
        name: created.name,
        schedule: "schedule" in created && created.schedule ? created.schedule : routine.cron,
        nextRun: "nextRun" in created ? created.nextRun : null,
        timezone,
        timezoneKnown: known,
      });
    } catch (error) {
      getLogger().error("starter routine", error);
    }
  }
  return made;
}

/** What the agent is told so it can say, once and in its own voice, what it set up. */
export function starterRoutinesPrompt(routines: readonly StarterRoutineSetup[]): string {
  const lines = routines.map(
    (routine) =>
      `- ${routine.agent}: "${routine.name}", ${routine.schedule}${routine.nextRun ? `, next ${routine.nextRun}` : ""}`,
  );
  const timezone = routines[0]?.timezone ?? "UTC";
  const known = routines[0]?.timezoneKnown ?? false;
  return [
    "These routines were just set up for them, ready to run, so nobody has to ask (you or your teammates made them):",
    ...lines,
    known
      ? `Times are in the person's timezone (${timezone}).`
      : "The person has not saved a timezone, so the times are in UTC. Say that in a few words and ask for their timezone.",
    "Say in a sentence or two what was set up and when, in everyday words, without listing every detail. Then ask one easy question: whether another time suits them better. They can change the time or remove a routine just by telling you, or from Routines.",
  ].join("\n");
}

/**
 * Queue one hidden-prompt turn so the agent tells the person what it set up, as the intro turn
 * does: the run is limited to its own message, and the text is written by the model.
 */
export async function enqueueRoutineAnnouncement(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  actor: { spaceId: string; userId: string },
  bot: { id: string; threadId: string | null },
  prompt: string,
): Promise<void> {
  if (!bot.threadId) return;
  const run = await deps.prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId: bot.threadId!,
        userId: actor.userId,
        prompt,
        status: "queued",
      },
    });
    return tx.run.create({
      data: {
        spaceId: actor.spaceId,
        botId: bot.id,
        threadId: bot.threadId!,
        taskId: task.id,
        userId: actor.userId,
        status: "queued",
        trigger: "created",
      },
      select: { id: true },
    });
  });
  await deps.jobs.enqueue(runContinueJob(run.id));
}
