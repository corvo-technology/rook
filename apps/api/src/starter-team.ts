import type { StarterRoutineSetup } from "@corvo/adapters";
import { addStoreAgent, enqueueRoutineAnnouncement, starterRoutinesPrompt } from "@corvo/adapters";
import type { Actor, AgentCatalogLocale, Bot, OnboardingPicks } from "@corvo/contracts";
import { AGENT_CATALOG, agentForPicks } from "@corvo/core";
import type { MessagingProvisionOptions, PrismaClient } from "@corvo/db";
import { createGroupRepos, ensureStarterTeam } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { RouterDeps } from "./router.js";
import { enqueueBotIntroRun } from "./routes/bots.js";
import { starterRoutineDeps } from "./starter-routines.js";

/**
 * Give an account its Chief and starting team, then have the Chief greet the person once, in
 * their language. A second call finds the Chief already there and starts nothing.
 */
export async function startStarterTeam(
  deps: Pick<RouterDeps, "prisma" | "jobs" | "env">,
  actor: Actor,
  locale: AgentCatalogLocale,
  steps: {
    ensure?: (
      prisma: PrismaClient,
      actor: Actor,
      locale: AgentCatalogLocale,
    ) => Promise<{ botId: string; created: boolean; bot?: Bot }>;
    greet?: typeof enqueueBotIntroRun;
    addAgent?: typeof addStoreAgent;
    createChannel?: (actor: Actor, input: { name: string; botIds: string[] }) => Promise<unknown>;
    routineDeps?: typeof starterRoutineDeps;
  } = {},
  picks?: OnboardingPicks,
): Promise<{
  botId: string;
  created: boolean;
  pickedAgent?: { botId: string; task: string | null };
}> {
  const ensure = steps.ensure ?? ensureStarterTeam;
  const { botId, created, bot } = await ensure(deps.prisma, actor, locale);
  // The team comes first, so the Chief's one first message can say what the team set up.
  const schedule = picks
    ? await (steps.routineDeps ?? starterRoutineDeps)(deps as RouterDeps, actor).catch(
        () => undefined,
      )
    : undefined;
  const starter = schedule ? { deps: schedule, announce: false } : undefined;
  const pickedAgent = await addPickedAgent(
    deps,
    actor,
    locale,
    botId,
    picks,
    steps.addAgent,
    starter,
  );
  const teamRoutines = await addSuggestedTeam(
    deps,
    actor,
    locale,
    botId,
    picks,
    steps.addAgent,
    steps.createChannel,
    starter,
  );
  const routines = [...(pickedAgent?.routines ?? []), ...teamRoutines];
  if (bot) {
    try {
      if (created) {
        const greet = steps.greet ?? enqueueBotIntroRun;
        // With no onboarding picks the person has not chosen a team yet, so the Chief proposes one.
        await greet(deps as RouterDeps, actor, bot, {
          locale,
          suggestTeam: !picks,
          ...(routines.length > 0 ? { starterRoutines: routines } : {}),
        });
      } else if (routines.length > 0 && schedule) {
        // The Chief was already there, so this is a separate short message about the new routines.
        await enqueueRoutineAnnouncement(
          schedule,
          actor,
          { id: bot.id, threadId: bot.threadId ?? null },
          starterRoutinesPrompt(routines),
        );
      }
    } catch (error) {
      // The Chief exists either way; the person can still talk to it.
      getLogger().error("chief intro run enqueue", error);
    }
  }
  return {
    botId,
    created,
    ...(pickedAgent ? { pickedAgent: { botId: pickedAgent.botId, task: pickedAgent.task } } : {}),
  };
}

/**
 * The ready-made agent the onboarding picks name, added beside the Chief with no greeting run and
 * no model call. The task is offered only while its chat is still empty. Never blocks: a failure
 * is logged and the person lands in the Chief's chat.
 */
async function addPickedAgent(
  deps: Pick<RouterDeps, "prisma">,
  actor: Actor,
  locale: AgentCatalogLocale,
  chiefId: string,
  picks: OnboardingPicks | undefined,
  addAgent: typeof addStoreAgent = addStoreAgent,
  starterRoutines?: Parameters<typeof addStoreAgent>[2]["starterRoutines"],
): Promise<{ botId: string; task: string | null; routines: StarterRoutineSetup[] } | undefined> {
  const entry = picks ? agentForPicks(picks) : null;
  if (!entry) return undefined;
  try {
    const chief = await deps.prisma.bot.findUnique({
      where: { id: chiefId },
      select: { fleetManagement: true },
    });
    // A Chief made without Store access (a partner's customer) gets no Store agent either.
    if (!chief?.fleetManagement) return undefined;
    const added = await addAgent(
      { prisma: deps.prisma },
      { spaceId: actor.spaceId, userId: actor.userId },
      { entry, locale, parentBotId: chiefId, ...(starterRoutines ? { starterRoutines } : {}) },
    );
    const messages = added.threadId
      ? await deps.prisma.message.count({ where: { threadId: added.threadId } })
      : 0;
    return {
      botId: added.botId,
      task: messages === 0 ? (entry.firstTask?.[locale] ?? null) : null,
      routines: added.routines,
    };
  } catch (error) {
    getLogger().error("onboarding picked agent", error);
    return undefined;
  }
}

/**
 * What a first message from a chat app starts: the Chief, written for that app, and its team. It
 * greets by answering the message that just arrived, so there is no greeting run to start. The
 * app's language is not sent with the message, so the Chief is made in English and follows the
 * language the person writes in.
 */
export function chiefAsFirstAgent(
  prisma: PrismaClient,
  ensure: typeof ensureStarterTeam = ensureStarterTeam,
): NonNullable<MessagingProvisionOptions["firstAgent"]> {
  return async ({ actor, provider }) => {
    const { botId } = await ensure(prisma, actor, "en", undefined, { channel: provider });
    return { botId };
  };
}

/**
 * The team the person kept in onboarding: each catalog agent beside the Chief, then a channel per
 * group with the Chief and its agents in it. Safe to repeat (agents are found by their catalog key,
 * channels by name), and never blocks: a failure is logged and the person lands in the Chief's chat.
 */
async function addSuggestedTeam(
  deps: Pick<RouterDeps, "prisma">,
  actor: Actor,
  locale: AgentCatalogLocale,
  chiefId: string,
  picks: OnboardingPicks | undefined,
  addAgent: typeof addStoreAgent = addStoreAgent,
  createChannel: NonNullable<Parameters<typeof startStarterTeam>[3]>["createChannel"] = (
    who,
    input,
  ) => createGroupRepos(deps.prisma).createGroup(who, input),
  starterRoutines?: Parameters<typeof addStoreAgent>[2]["starterRoutines"],
): Promise<StarterRoutineSetup[]> {
  const routines: StarterRoutineSetup[] = [];
  if (!picks?.agents?.length) return routines;
  try {
    const chief = await deps.prisma.bot.findUnique({
      where: { id: chiefId },
      select: { fleetManagement: true },
    });
    if (!chief?.fleetManagement) return routines;
    const botBySlug = new Map<string, string>();
    for (const slug of picks.agents) {
      const entry = AGENT_CATALOG.find((candidate) => candidate.slug === slug);
      if (!entry) continue;
      try {
        const added = await addAgent(
          { prisma: deps.prisma },
          { spaceId: actor.spaceId, userId: actor.userId },
          { entry, locale, parentBotId: chiefId, ...(starterRoutines ? { starterRoutines } : {}) },
        );
        botBySlug.set(slug, added.botId);
        routines.push(...added.routines);
      } catch (error) {
        getLogger().error("onboarding team agent", error);
      }
    }
    const existing = new Set(
      (
        await deps.prisma.chatGroup.findMany({
          where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
          select: { name: true },
        })
      ).map((row) => row.name.toLowerCase()),
    );
    for (const channel of picks.channels ?? []) {
      if (existing.has(channel.name.toLowerCase())) continue;
      const members = channel.agentSlugs.flatMap((slug) => botBySlug.get(slug) ?? []);
      if (members.length === 0) continue;
      try {
        await createChannel(actor, { name: channel.name, botIds: [chiefId, ...members] });
        existing.add(channel.name.toLowerCase());
      } catch (error) {
        getLogger().error("onboarding team channel", error);
      }
    }
  } catch (error) {
    getLogger().error("onboarding team", error);
  }
  return routines;
}
