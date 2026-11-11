import type { MissionId, MissionsView } from "@corvo/contracts";
import { MISSIONS, missionsVisible } from "@corvo/core";

/** Where a mission is done on a phone; the rest have no screen that completes them in one step. */
const HREF: Partial<Record<MissionId, string>> = {
  routine: "/routines",
  connect: "/integrations",
  memory: "/wiki",
};

export type MissionRow = { id: MissionId; title: string; done: boolean; href: string | null };

/** The mission list for the account screen; empty once the navigation stopped growing. */
export function missionRows(
  view: MissionsView | null,
  t: (message: string) => string,
): MissionRow[] {
  if (!view || !missionsVisible(view)) return [];
  const titles: Record<MissionId, string> = {
    talk: t("Talk to your agent"),
    decide: t("Answer a request"),
    connect: t("Connect an app"),
    second: t("Add a second agent"),
    routine: t("Schedule a routine"),
    memory: t("Keep a memory"),
  };
  return MISSIONS.map(({ id }) => ({
    id,
    title: titles[id],
    done: view.completed.includes(id),
    href: HREF[id] ?? null,
  }));
}
