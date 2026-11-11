import type { MissionId, MissionsView, NavPart } from "@corvo/contracts";
import { MISSION_IDS } from "@corvo/contracts";

/** What is true of a member's space right now, as far as the missions care. */
export type MissionFacts = {
  replied: boolean;
  decided: boolean;
  connections: number;
  agents: number;
  routines: number;
  memories: number;
};

export const MISSIONS: readonly {
  id: MissionId;
  brings: readonly NavPart[];
  done: (facts: MissionFacts) => boolean;
}[] = [
  { id: "talk", brings: ["usage", "artifacts"], done: (f) => f.replied },
  { id: "decide", brings: ["approvals"], done: (f) => f.decided },
  { id: "connect", brings: [], done: (f) => f.connections > 0 },
  { id: "second", brings: ["team", "workflows", "board"], done: (f) => f.agents >= 2 },
  { id: "routine", brings: ["routines"], done: (f) => f.routines > 0 },
  { id: "memory", brings: ["memory", "wiki"], done: (f) => f.memories > 0 },
];

/** The missions done now plus those already latched, in list order; none is ever dropped. */
export function completedMissions(facts: MissionFacts, already: readonly MissionId[]): MissionId[] {
  const done = new Set<MissionId>(already);
  for (const mission of MISSIONS) if (mission.done(facts)) done.add(mission.id);
  return MISSION_IDS.filter((id) => done.has(id));
}

/** Whether a part of the navigation shows; `current` is the page the person is on. */
export function partShows(
  part: NavPart,
  view: MissionsView | null,
  current?: NavPart | null,
): boolean {
  if (!view?.short) return true;
  if (current === part || view.has.includes(part)) return true;
  return MISSIONS.some(
    (mission) => mission.brings.includes(part) && view.completed.includes(mission.id),
  );
}

/** Parts a completed mission brought that the person has not opened yet. */
export function newParts(view: MissionsView | null): NavPart[] {
  if (!view?.short) return [];
  const parts = new Set<NavPart>();
  for (const mission of MISSIONS) {
    if (!view.completed.includes(mission.id)) continue;
    for (const part of mission.brings) if (!view.seen.includes(part)) parts.add(part);
  }
  return [...parts];
}

/** The list shows while the navigation is growing and a mission is left. */
export function missionsVisible(view: MissionsView | null): boolean {
  return Boolean(view?.short) && MISSION_IDS.some((id) => !view?.completed.includes(id));
}
