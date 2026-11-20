import type { AgentCatalogLocale } from "@corvo/contracts";

export type AppMapLocale = AgentCatalogLocale;

export type AppMapSurface = "web" | "desktop" | "mobile";

/** The least a person must be to use a screen: any member, the space's owner/admin, or a partner. */
export type AppMapAudience = "member" | "owner" | "partner";

export type AppMapText = { title: string; description: string; keywords: readonly string[] };

/** One screen, settings section or main action, with the link that opens it. */
export interface AppMapEntry {
  id: string;
  /** The in-app path that opens it, such as `/settings/connections`. */
  path: string;
  audience: AppMapAudience;
  surfaces: readonly AppMapSurface[];
  text: Record<AppMapLocale, AppMapText>;
}
