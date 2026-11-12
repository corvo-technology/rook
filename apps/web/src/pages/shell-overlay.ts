const SETTINGS_SECTIONS = [
  "general",
  "models",
  "voice",
  "approvals",
  "memory",
  "usage",
  "mcp",
  "computer",
  "billing",
  "partnership",
  "connections",
  "updates",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Settings, the Store and MCP servers used to open over the shell from these URL params. */
const LEGACY_KEYS = ["settings", "space", "integrations", "mcp", "messaging"] as const;

function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Where an old `?settings=`, `?integrations` or `?mcp=` link now goes, and the params it leaves
 * behind. Those surfaces are pages, so a bookmark or a reload lands on the page.
 */
export function legacyOverlayTarget(
  params: URLSearchParams,
): { to: string; rest: URLSearchParams } | null {
  const section = params.get("settings");
  const mcp = params.get("mcp");
  let to: string | null = null;
  if (section !== null) {
    const spaceId = params.get("space");
    if (section === "space" && spaceId) to = `/settings/space/${encodeURIComponent(spaceId)}`;
    else if (section === "confirmations") to = "/settings/approvals";
    else to = `/settings/${isSettingsSection(section) ? section : "general"}`;
  } else if (params.has("integrations")) to = "/app/store";
  else if (mcp !== null)
    to = mcp ? `/settings/mcp?server=${encodeURIComponent(mcp)}` : "/settings/mcp";
  if (!to) return null;
  const rest = new URLSearchParams(params);
  for (const key of LEGACY_KEYS) rest.delete(key);
  return { to, rest };
}

/** A `?search` string that writes flag params bare (`?plans`, not `?plans=`). */
export function searchString(params: URLSearchParams): string {
  const query = params.toString().replace(/=(?=&|$)/g, "");
  return query ? `?${query}` : "";
}

/** The params a redirect keeps: the plan choice opens above the app, so it survives them. */
export function shellOverlaySearch(params: URLSearchParams): string {
  return params.has("plans") ? "?plans" : "";
}
