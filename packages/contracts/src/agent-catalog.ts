import { z } from "zod";
import { BotAvatarValueSchema } from "./bot-avatar.js";
import { BuiltinToolNameSchema } from "./builtin-tools.js";

export const AGENT_CATALOG_LOCALES = ["en", "pt-BR"] as const;
export type AgentCatalogLocale = (typeof AGENT_CATALOG_LOCALES)[number];

/** What an agent or a skill is for, so the Store can be filtered by it. */
export const STORE_CATEGORIES = [
  "finance",
  "marketing",
  "design",
  "sales",
  "support",
  "operations",
  "people",
  "development",
  "knowledge",
] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];

/** Text written once per catalog language; shared by the agent and skill catalogs. */
export const localizedCatalogText = (max: number) =>
  z.object({
    en: z.string().trim().min(1).max(max),
    "pt-BR": z.string().trim().min(1).max(max),
  });

/**
 * A ready-made agent a person can add: a bot with its own instructions and the apps it works
 * with. Text is written once per language; other app languages use the English text.
 */
export const AgentCatalogEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  category: z.enum(STORE_CATEGORIES),
  name: localizedCatalogText(60),
  description: localizedCatalogText(200),
  instructions: localizedCatalogText(4000),
  color: BotAvatarValueSchema,
  /** App catalog slugs the agent uses; ones not connected yet are offered after it is added. */
  apps: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).max(4),
  /** Skill store slugs the agent works best with; adding the agent installs the ones missing. */
  skills: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
    .max(8)
    .optional(),
  /** Built-in tools turned off for this agent because another agent's job is to use them. */
  disabledTools: z.array(BuiltinToolNameSchema).max(24).optional(),
  /** The first message sent to the agent when it needs setup before it can work. */
  greeting: localizedCatalogText(200).optional(),
  /** A first message that waits unsent in the composer; it asks before acting. */
  firstTask: localizedCatalogText(200).optional(),
  /** The email agent is installed through its own setup, which needs an inbox service. */
  setup: z.literal("email").optional(),
});
export type AgentCatalogEntry = z.infer<typeof AgentCatalogEntrySchema>;

/** The key a bot created from a catalog entry carries, so the catalog can tell it was added. */
export function agentCatalogSpawnKey(slug: string): string {
  return `agent-catalog:${slug}`;
}

/** The catalog's language for an app language: Portuguese variants read Portuguese, the rest English. */
export function agentCatalogLocale(appLocale: string): AgentCatalogLocale {
  return appLocale.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}
