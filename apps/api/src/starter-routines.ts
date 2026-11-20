import type { StarterRoutineSetup } from "@corvo/adapters";
import { createStarterRoutines } from "@corvo/adapters";
import type { Actor, AgentCatalogLocale, Bot } from "@corvo/contracts";
import { agentCatalogLocale, agentCatalogSpawnKey } from "@corvo/contracts";
import { AGENT_CATALOG, can } from "@corvo/core";
import type { RouterDeps } from "./router.js";
import { modelSetup } from "./routes/shared.js";
import { getSpaceMembership } from "./space-owner.js";

/**
 * What a catalog agent's starter routines need from the server: the routine scheduler, or nothing
 * when they cannot be made. Routines are not made without a model set up (they could never run),
 * where the person may not manage routines, or on the scripted test runtime.
 */
export async function starterRoutineDeps(
  deps: Pick<RouterDeps, "prisma" | "jobs" | "events" | "env">,
  actor: Actor,
) {
  if (deps.env.agentRuntime === "scripted") return undefined;
  if ((await modelSetup(deps as RouterDeps, actor)).needsModel) return undefined;
  if (!can(await getSpaceMembership(deps.prisma, actor), "manage_routines")) return undefined;
  return { prisma: deps.prisma, jobs: deps.jobs, events: deps.events };
}

/**
 * The routines a catalog agent made through the Store's create call starts with. A bot that
 * already had a run was added before, so adding it again changes nothing.
 */
export async function setUpCatalogRoutines(
  deps: Pick<RouterDeps, "prisma" | "jobs" | "events" | "env">,
  actor: Actor,
  bot: Bot,
): Promise<StarterRoutineSetup[]> {
  const entry = AGENT_CATALOG.find(
    (candidate) =>
      bot.spawnKey === agentCatalogSpawnKey(candidate.slug) &&
      !candidate.partnerAccess &&
      !candidate.setup,
  );
  if (!entry?.routines?.length) return [];
  const schedule = await starterRoutineDeps(deps, actor);
  if (!schedule) return [];
  if (await deps.prisma.run.findFirst({ where: { botId: bot.id }, select: { id: true } })) {
    return [];
  }
  // The create call carries the agent's name in the person's language, not the language itself.
  const locale: AgentCatalogLocale =
    entry.name["pt-BR"] === bot.name ? agentCatalogLocale("pt") : "en";
  return createStarterRoutines(schedule, {
    entry,
    locale,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId: bot.id,
    threadId: bot.threadId ?? null,
    botName: bot.name,
  });
}
