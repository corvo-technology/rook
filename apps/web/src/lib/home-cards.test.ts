import type { PendingApproval, RoutineOccurrence, RunActivityRow } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { daypart, HOME_CARD_LIMIT, routinesCard, waitingCard, workingCard } from "./home-cards";

const approval = (id: string, createdAt: string) =>
  ({
    runId: `run-${id}`,
    messageId: id,
    botId: "bot",
    botName: "Bot",
    botColor: "#000000",
    block: { kind: "ask", text: "Send it?" },
    createdAt,
  }) as PendingApproval;

const run = (id: string, status: RunActivityRow["status"], updatedAt: string) =>
  ({ runId: id, status, updatedAt }) as RunActivityRow;

const occurrence = (id: string, at: string, state: RoutineOccurrence["state"]) =>
  ({ routineId: id, name: id, at, state }) as RoutineOccurrence;

describe("daypart", () => {
  it("greets by the local hour", () => {
    expect([4, 5, 11].map(daypart)).toEqual(["evening", "morning", "morning"]);
    expect([12, 17].map(daypart)).toEqual(["afternoon", "afternoon"]);
    expect([18, 23, 0].map(daypart)).toEqual(["evening", "evening", "evening"]);
  });
});

describe("waitingCard", () => {
  it("lists the longest wait first and counts all of them", () => {
    const card = waitingCard([
      approval("b", "2026-01-01T10:00:00Z"),
      approval("a", "2026-01-01T09:00:00Z"),
    ]);
    expect(card.items.map((item) => item.messageId)).toEqual(["a", "b"]);
    expect(card.total).toBe(2);
  });

  it("shows only a few and still counts the rest", () => {
    const many = Array.from({ length: HOME_CARD_LIMIT + 3 }, (_, index) =>
      approval(String(index), `2026-01-01T10:0${index}:00Z`),
    );
    const card = waitingCard(many);
    expect(card.items).toHaveLength(HOME_CARD_LIMIT);
    expect(card.total).toBe(many.length);
  });

  it("is empty with nothing waiting", () => {
    expect(waitingCard([])).toEqual({ items: [], total: 0 });
  });
});

describe("workingCard", () => {
  it("keeps the runs that are going, newest first, and leaves out those waiting on a person", () => {
    const card = workingCard([
      run("old", "running", "2026-01-01T10:00:00Z"),
      run("new", "queued", "2026-01-01T11:00:00Z"),
      run("ask", "waiting_input", "2026-01-01T12:00:00Z"),
      run("done", "completed", "2026-01-01T12:30:00Z"),
    ]);
    expect(card.items.map((item) => item.runId)).toEqual(["new", "old"]);
    expect(card.total).toBe(2);
  });
});

describe("routinesCard", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("lists what is due next, soonest first, and skips what already ran", () => {
    const card = routinesCard(
      [
        occurrence("later", "2026-01-02T09:00:00Z", "upcoming"),
        occurrence("soon", "2026-01-01T13:00:00Z", "upcoming"),
        occurrence("ran", "2026-01-01T08:00:00Z", "done"),
        occurrence("missed", "2026-01-01T07:00:00Z", "upcoming"),
      ],
      now,
    );
    expect(card.items.map((item) => item.routineId)).toEqual(["soon", "later"]);
  });
});
