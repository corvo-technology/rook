export type Section =
  | "agents"
  | "board"
  | "team"
  | "routines"
  | "workflows"
  | "usage"
  | "artifacts"
  | "wiki";

/** The section a path belongs to; custom links are reached from the account menu. */
export function railSection(pathname: string, _search: string): Section | null {
  if (pathname.startsWith("/app/team")) return "team";
  if (pathname.startsWith("/app/routines")) return "routines";
  if (pathname.startsWith("/app/workflows")) return "workflows";
  if (pathname.startsWith("/app/artifacts")) return "artifacts";
  if (pathname.startsWith("/app/wiki")) return "wiki";
  if (pathname.startsWith("/app/usage")) return "usage";
  if (pathname.startsWith("/app/board")) return "board";
  if (pathname.startsWith("/app/x/")) return null;
  if (pathname === "/settings/usage") return "usage";
  return "agents";
}
