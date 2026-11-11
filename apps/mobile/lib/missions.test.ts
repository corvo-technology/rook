import type { MissionsView } from "@corvo/contracts";
import { MISSION_IDS } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { missionRows } from "./missions";

const identity = (message: string) => message;
const view = (over: Partial<MissionsView> = {}): MissionsView => ({
  short: true,
  completed: [],
  has: [],
  seen: [],
  ...over,
});

describe("missionRows", () => {
  it("is empty without a view, outside short mode and when all are done", () => {
    expect(missionRows(null, identity)).toEqual([]);
    expect(missionRows(view({ short: false }), identity)).toEqual([]);
    expect(missionRows(view({ completed: [...MISSION_IDS] }), identity)).toEqual([]);
  });

  it("lists the six missions in order with the done ones marked", () => {
    const rows = missionRows(view({ completed: ["talk"] }), identity);
    expect(rows.map((row) => row.id)).toEqual([...MISSION_IDS]);
    expect(rows.filter((row) => row.done).map((row) => row.id)).toEqual(["talk"]);
    expect(rows.map((row) => row.title)).toEqual([
      "Talk to your agent",
      "Answer a request",
      "Connect an app",
      "Add a second agent",
      "Schedule a routine",
      "Keep a memory",
    ]);
  });

  it("points a mission at a screen only where one exists", () => {
    const hrefs = Object.fromEntries(
      missionRows(view(), identity).map((row) => [row.id, row.href]),
    );
    expect(hrefs).toEqual({
      talk: null,
      decide: null,
      connect: "/integrations",
      second: null,
      routine: "/routines",
      memory: "/wiki",
    });
  });
});
