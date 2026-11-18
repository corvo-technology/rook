import type {
  PendingApproval,
  RoutineOccurrence,
  RunActivityRow,
  RunStatus,
} from "@corvo/contracts";

export type Daypart = "morning" | "afternoon" | "evening";

/** Which greeting an hour of the local day gets. */
export function daypart(hour: number): Daypart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

/** How many entries a Home card lists before "See all". */
export const HOME_CARD_LIMIT = 4;

export type HomeCard<Item> = { items: Item[]; total: number };

const limited = <Item>(all: Item[]): HomeCard<Item> => ({
  items: all.slice(0, HOME_CARD_LIMIT),
  total: all.length,
});

/** What waits on the person: approvals and questions, the one waiting longest first. */
export function waitingCard(approvals: readonly PendingApproval[]): HomeCard<PendingApproval> {
  return limited([...approvals].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
}

const WORKING: ReadonlySet<RunStatus> = new Set(["queued", "leased", "running"]);

/** Runs that are going now; a run waiting on a person is that person's card, not this one. */
export function workingCard(runs: readonly RunActivityRow[]): HomeCard<RunActivityRow> {
  return limited(
    runs
      .filter((run) => WORKING.has(run.status))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  );
}

/** The next scheduled runs, soonest first; runs that already happened are left out. */
export function routinesCard(
  occurrences: readonly RoutineOccurrence[],
  now: Date,
): HomeCard<RoutineOccurrence> {
  return limited(
    occurrences
      .filter((entry) => entry.state === "upcoming" && Date.parse(entry.at) >= now.getTime())
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
  );
}
