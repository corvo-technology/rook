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
 * A routine a catalog agent sets up for its owner when it is added. It only reads, summarizes,
 * drafts or reminds: anything it does outside the app is still approved when the routine runs.
 */
export const StarterRoutineSchema = z.object({
  /** Stable within the agent; never shown. */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: localizedCatalogText(60),
  /** What the agent is asked each time the routine runs. */
  prompt: localizedCatalogText(600),
  /** Five-field cron in the owner's timezone, repeating. */
  cron: z.string().regex(/^\S+ \S+ \S+ \S+ \S+$/),
});
export type StarterRoutine = z.infer<typeof StarterRoutineSchema>;

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
  /** Recurring jobs the agent sets up on its own when it is added, one or two. */
  routines: z.array(StarterRoutineSchema).max(2).optional(),
  /**
   * Offered only to an organization that is a member of a partner, and added with this access to
   * the Partnership connection.
   */
  partnerAccess: z.literal("read").optional(),
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
