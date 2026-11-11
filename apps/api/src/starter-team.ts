import { addStoreAgent } from "@corvo/adapters";
import type { Actor, AgentCatalogLocale, Bot, OnboardingPicks } from "@corvo/contracts";
import { agentForPicks } from "@corvo/core";
import type { MessagingProvisionOptions, PrismaClient } from "@corvo/db";
import { ensureStarterTeam } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { RouterDeps } from "./router.js";
import { enqueueBotIntroRun } from "./routes/bots.js";

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
  } = {},
  picks?: OnboardingPicks,
): Promise<{
  botId: string;
  created: boolean;
  pickedAgent?: { botId: string; task: string | null };
}> {
  const ensure = steps.ensure ?? ensureStarterTeam;
  const { botId, created, bot } = await ensure(deps.prisma, actor, locale);
  if (created && bot) {
    const greet = steps.greet ?? enqueueBotIntroRun;
    try {
      await greet(deps as RouterDeps, actor, bot);
    } catch (error) {
      // The Chief exists either way; the person can still talk to it.
      getLogger().error("chief intro run enqueue", error);
    }
  }
  const pickedAgent = await addPickedAgent(deps, actor, locale, botId, picks, steps.addAgent);
  return { botId, created, ...(pickedAgent ? { pickedAgent } : {}) };
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
): Promise<{ botId: string; task: string | null } | undefined> {
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
      { entry, locale, parentBotId: chiefId },
    );
    const messages = added.threadId
      ? await deps.prisma.message.count({ where: { threadId: added.threadId } })
      : 0;
    return {
      botId: added.botId,
      task: messages === 0 ? (entry.firstTask?.[locale] ?? null) : null,
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
