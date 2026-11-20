import type { Actor, AgentCatalogLocale, Bot } from "@corvo/contracts";
import { CHIEF_AGENT, chiefInstructions, MASCOT_COLORS } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";

export const CHIEF_SPAWN_KEY = "onboarding:first";
/** The Chief's name before it was localized; older accounts still have it. */
const LEGACY_CHIEF_NAME = "Chief";

type Repos = Pick<ReturnType<typeof createRepos>, "createBot">;

/**
 * Give a new account its first agent: the Chief, in the person's language. It starts alone and
 * adds the Store's agents the person asks for. Calling it again returns the Chief that is already
 * there. `created` says whether this call made the Chief, so the caller can start its greeting
 * once. `channel` is the chat app the person reached us through, which shapes how the Chief
 * writes. `name` replaces the localized name, for a partner that brands its Chief.
 */
export async function ensureStarterTeam(
  prisma: PrismaClient,
  actor: Actor,
  locale: AgentCatalogLocale,
  repos: Repos = createRepos(prisma),
  options: { channel?: string; storeAccess?: boolean; name?: string } = {},
): Promise<{ botId: string; created: boolean /** The Chief this call made. */; bot?: Bot }> {
  const active = () =>
    prisma.bot.findMany({
      where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
      select: { id: true, name: true, spawnKey: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
  const chiefOf = (bots: Awaited<ReturnType<typeof active>>) =>
    bots.find((bot) => bot.spawnKey === CHIEF_SPAWN_KEY) ??
    bots.find((bot) => bot.name === LEGACY_CHIEF_NAME);

  const before = await active();
  const existing = chiefOf(before);
  if (existing) {
    return { botId: existing.id, created: false };
  }

  let chief: Bot;
  try {
    chief = await repos.createBot(actor, {
      name: options.name ?? CHIEF_AGENT.name[locale],
      title: "",
      description: CHIEF_AGENT.description[locale],
      instructions: chiefInstructions(locale, options.channel),
      notifyOnFinish: true,
      // The first bot wears the brand mascot; its color can be changed in Avatar Studio.
      color: MASCOT_COLORS[0].hex,
      // The coordinator may look up and add Store agents; changes to other agents still need approval.
      fleetManagement: options.storeAccess !== false,
      // The coordinator routes a request to the squad that fits, without being a member of each.
      squadRouting: true,
      spawnKey: CHIEF_SPAWN_KEY,
      // A second space on a one-computer plan still gets its Chief; the computer follows at its first run.
      allowWithoutComputer: true,
    });
  } catch (error) {
    // Another tab or request won the unique (space, key) race; use that Chief only.
    const winner = chiefOf(await active());
    if (!winner) throw error;
    return { botId: winner.id, created: false };
  }
  return { botId: chief.id, created: true, bot: chief };
}
