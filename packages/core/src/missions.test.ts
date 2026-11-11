import type { MissionId, MissionsView, NavPart } from "@corvo/contracts";
import { MISSION_IDS, NAV_PARTS } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  completedMissions,
  MISSIONS,
  type MissionFacts,
  missionsVisible,
  newParts,
  partShows,
} from "./missions.js";

const none: MissionFacts = {
  replied: false,
  decided: false,
  connections: 0,
  agents: 0,
  routines: 0,
  memories: 0,
};

function view(over: Partial<MissionsView> = {}): MissionsView {
  return { short: true, completed: [], has: [], seen: [], ...over };
}

describe("MISSIONS", () => {
  it("lists the missions in order", () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([...MISSION_IDS]);
  });

  it("brings every part exactly once", () => {
    for (const part of NAV_PARTS) {
      expect(MISSIONS.filter((m) => m.brings.includes(part))).toHaveLength(1);
    }
    const brings = (id: MissionId) => MISSIONS.find((m) => m.id === id)?.brings;
    expect(brings("connect")).toEqual([]);
    expect(brings("second")).toEqual(["team", "workflows", "board"]);
    expect(brings("memory")).toEqual(["memory", "wiki"]);
  });
});

describe("completedMissions", () => {
  it("is empty without facts", () => {
    expect(completedMissions(none, [])).toEqual([]);
  });

  it("needs two agents for the second", () => {
    expect(completedMissions({ ...none, agents: 1 }, [])).not.toContain("second");
    expect(completedMissions({ ...none, agents: 2 }, [])).toContain("second");
  });

  it("never drops a latched mission", () => {
    expect(completedMissions(none, ["routine"])).toEqual(["routine"]);
  });

  it("keeps list order", () => {
    expect(completedMissions({ ...none, memories: 1, replied: true }, ["routine"])).toEqual([
      "talk",
      "routine",
      "memory",
    ]);
  });
});

describe("partShows", () => {
  it("shows everything without a view", () => {
    expect(partShows("routines", null)).toBe(true);
  });

  it("shows everything outside short mode", () => {
    for (const part of NAV_PARTS) expect(partShows(part, view({ short: false }))).toBe(true);
  });

  it("hides a part nothing brought", () => {
    expect(partShows("routines", view())).toBe(false);
  });

  it("shows a part for its mission, its content or the current page", () => {
    expect(partShows("routines", view({ completed: ["routine"] }))).toBe(true);
    expect(partShows("routines", view({ has: ["routines"] }))).toBe(true);
    expect(partShows("routines", view(), "routines")).toBe(true);
  });

  it("brings usage and artifacts with the first reply", () => {
    for (const part of ["usage", "artifacts"] as NavPart[]) {
      expect(partShows(part, view())).toBe(false);
      expect(partShows(part, view({ completed: ["talk"] }))).toBe(true);
    }
  });
});

describe("newParts", () => {
  it("lists parts a completed mission brought", () => {
    expect(newParts(view({ completed: ["talk"] }))).toEqual(["usage", "artifacts"]);
  });

  it("drops a part once seen", () => {
    expect(newParts(view({ completed: ["talk"], seen: ["usage"] }))).toEqual(["artifacts"]);
  });

  it("is empty outside short mode or without a view", () => {
    expect(newParts(view({ short: false, completed: ["talk"] }))).toEqual([]);
    expect(newParts(null)).toEqual([]);
  });

  it("never marks a part that only has content", () => {
    expect(newParts(view({ has: ["routines"] }))).toEqual([]);
  });
});

describe("missionsVisible", () => {
  it("shows while short and unfinished", () => {
    expect(missionsVisible(view())).toBe(true);
  });

  it("hides without a view, outside short mode and when all are done", () => {
    expect(missionsVisible(null)).toBe(false);
    expect(missionsVisible(view({ short: false }))).toBe(false);
    expect(missionsVisible(view({ completed: [...MISSION_IDS] }))).toBe(false);
  });
});
