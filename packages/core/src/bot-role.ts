import { agentCatalogLocale } from "@corvo/contracts";
import { CHIEF_BOT_SPAWN_KEY } from "./bot-sections.js";

/** What the Chief's role line says. The stored default stays as the Rook identity migration wrote it. */
const CHIEF_ROLE = { en: "your right hand", "pt-BR": "seu braço direito" } as const;

/**
 * The role line shown under an agent's name. The Chief always reads as the owner's right hand,
 * whatever title an older row or the agent itself stored; every other agent shows its own.
 */
export function botRole(
  bot: { spawnKey?: string | null; title?: string | null } | undefined,
  locale: string,
): string {
  if (bot?.spawnKey === CHIEF_BOT_SPAWN_KEY) return CHIEF_ROLE[agentCatalogLocale(locale)];
  return bot?.title ?? "";
}
