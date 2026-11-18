import type { RoutineOccurrence, RunActivityRow } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  clock,
  countUpValue,
  greetingName,
  statusCounts,
  stepText,
  timelineGroups,
} from "./home-live";

const at = (hour: number, minute = 0, day = 10) => new Date(2026, 10, day, hour, minute);
const occurrence = (
  id: string,
  when: Date,
  state: RoutineOccurrence["state"] = "upcoming",
): RoutineOccurrence =>
  ({
    routineId: id,
    name: id,
    botId: "bot",
    botName: "Bot",
    at: when.toISOString(),
    state,
    runId: null,
  }) as RoutineOccurrence;

describe("greetingName", () => {
  it("prefers the member's display name, then the account name", () => {
    expect(greetingName({ displayName: "Ana Souza", name: "Zed" })).toBe("Ana");
    expect(greetingName({ name: "Pedro Henrique", email: "p@x.test" })).toBe("Pedro");
  });

  it("never greets a placeholder name", () => {
    expect(greetingName({ name: "Account", email: "maria.lima@x.test" })).toBe("Maria");
    expect(greetingName({ name: "user", email: "joao@x.test" })).toBe("Joao");
    expect(greetingName({ name: "Account", email: "account@x.test" })).toBe("");
  });

  it("is empty when nothing is known", () => {
    expect(greetingName({})).toBe("");
  });
});

describe("statusCounts", () => {
  it("counts the team and the minutes to the next routine", () => {
    const now = at(10);
    expect(
      statusCounts({
        workingTotal: 3,
        waitingTotal: 2,
        upcoming: [occurrence("b", at(10, 40)), occurrence("a", at(10, 14))],
        now,
      }),
    ).toEqual({ working: 3, waiting: 2, nextInMinutes: 14 });
  });

  it("has no next routine when none is ahead", () => {
    const status = statusCounts({
      workingTotal: 0,
      waitingTotal: 0,
      upcoming: [occurrence("old", at(9), "done")],
      now: at(10),
    });
    expect(status.nextInMinutes).toBeNull();
  });
});

describe("timelineGroups", () => {
  const now = at(12);
  const timeline = timelineGroups(
    [
      occurrence("tomorrow", at(8, 0, 11)),
      occurrence("evening", at(18)),
      occurrence("morning", at(8), "done"),
      occurrence("later", at(9, 0, 12)),
    ],
    now,
  );

  it("splits today from tomorrow in time order and drops later days", () => {
    expect(timeline.today.map((entry) => entry.routineId)).toEqual(["morning", "evening"]);
    expect(timeline.tomorrow.map((entry) => entry.routineId)).toEqual(["tomorrow"]);
  });

  it("puts the now line before the first entry still ahead", () => {
    expect(timeline.today.map((entry) => entry.past)).toEqual([true, false]);
    expect(timeline.nowIndex).toBe(1);
  });

  it("puts the now line last when today is over", () => {
    const over = timelineGroups([occurrence("a", at(8), "done")], now);
    expect(over.nowIndex).toBe(1);
  });
});

describe("live text", () => {
  it("shows the agent's latest message, else what it was asked", () => {
    const base = { promptSnippet: "Write the report", agentMessage: null } as RunActivityRow;
    expect(stepText(base)).toBe("Write the report");
    expect(
      stepText({
        ...base,
        agentMessage: { kind: "update", fromBotName: "A", text: "Reading the sheet" },
      }),
    ).toBe("Reading the sheet");
  });

  it("formats elapsed time", () => {
    expect(clock(65_000)).toBe("1:05");
    expect(clock(3_725_000)).toBe("1:02:05");
  });

  it("counts up, and jumps to the target when motion is reduced", () => {
    expect(countUpValue(10, 0, 900, false)).toBe(0);
    expect(countUpValue(10, 450, 900, false)).toBeGreaterThan(5);
    expect(countUpValue(10, 900, 900, false)).toBe(10);
    expect(countUpValue(10, 0, 900, true)).toBe(10);
  });
});
