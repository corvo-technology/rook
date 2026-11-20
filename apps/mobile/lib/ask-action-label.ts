export type AskAction = { id: string; label: string; outcome?: "created" | "cancelled" };

export function askActionLabel(
  action: AskAction,
  {
    approval,
    site,
    proposal,
    scoped,
  }: { approval: boolean; site?: string; proposal?: boolean; scoped?: boolean },
  t: (message: string, values?: Record<string, string | number>) => string,
): string {
  if (!approval) return action.label;
  if (action.outcome === "created") return t("Create space");
  if (action.outcome === "cancelled") return t("Cancel");
  // A proposal describes a change, not a permission.
  if (proposal && action.id === "allow") return t("Apply");
  if (proposal && action.id === "deny") return t("Dismiss");
  if (action.id === "allow") return t("Allow once");
  if (action.id === "always") {
    if (site) return t("Always allow {site}", { site });
    return scoped ? t("Always allow") : t("Always allow this tool");
  }
  if (action.id === "deny") return t("Not now");
  return action.label;
}
