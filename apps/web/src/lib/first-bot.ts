import type { AgentCatalogLocale, OnboardingPicks } from "@corvo/contracts";
import { rpc } from "./rpc";

export const FIRST_BOT_SPAWN_KEY = "onboarding:first";
/** The first bot's name before it was localized; older accounts still have it. */
const LEGACY_FIRST_BOT_NAME = "Chief";

export function findFirstBot(
  bots: Array<{ id: string; name: string; spawnKey: string | null }>,
): { id: string } | undefined {
  const bySpawnKey = bots.find((bot) => bot.spawnKey === FIRST_BOT_SPAWN_KEY);
  if (bySpawnKey) return { id: bySpawnKey.id };
  // Legacy first-run Chief created before spawnKey was set.
  const byName = bots.find((bot) => bot.name === LEGACY_FIRST_BOT_NAME);
  return byName ? { id: byName.id } : undefined;
}

/**
 * The account's Chief and starting team. The server makes them, in the app's language, and
 * returns the Chief that is already there when called again (another tab, a reload).
 */
export type FirstBot = { id: string; pickedAgent?: { botId: string; task: string | null } };

export async function createOrReuseFirstBot(
  locale: AgentCatalogLocale,
  picks?: OnboardingPicks,
): Promise<FirstBot> {
  const { botId, pickedAgent } = await rpc.onboarding.ensureTeam({
    locale,
    ...(picks ? { picks } : {}),
  });
  return { id: botId, ...(pickedAgent ? { pickedAgent } : {}) };
}

const FIRST_BOT_LOCK = "corvo:onboarding-first-bot";

/** Survives StrictMode remounts; concurrent first-bot creates share one in-flight attempt. */
let firstBotEnsure: Promise<FirstBot> | null = null;

export async function withFirstBotLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return run();
  return locks.request(FIRST_BOT_LOCK, run);
}

export async function ensureFirstBot(
  locale: AgentCatalogLocale,
  picks?: OnboardingPicks,
): Promise<FirstBot> {
  if (firstBotEnsure) return firstBotEnsure;
  // Web Lock serializes cross-tab creates; module promise covers same-tab StrictMode.
  // spawnKey makes create idempotent when locks are unavailable.
  // Clear after settle so a later empty-space visit re-lists instead of reusing a deleted id.
  firstBotEnsure = withFirstBotLock(() => createOrReuseFirstBot(locale, picks)).finally(() => {
    firstBotEnsure = null;
  });
  return firstBotEnsure;
}
