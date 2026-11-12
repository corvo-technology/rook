import type { Ticket } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { arrangeLanes, laneForKey, placeSaved } from "./board-drag";

function ticket(id: string, status: Ticket["status"]): Ticket {
  return {
    id,
    boardId: "board-1",
    spaceId: "space-1",
    number: 1,
    ref: `RAK-${id}`,
    title: id,
    description: null,
    status,
    priority: "normal",
    assigneeBotId: null,
    createdByBotId: null,
    createdByUserId: null,
    createdAt: "2026-10-10T10:00:00Z",
    updatedAt: "2026-10-10T10:00:00Z",
    completedAt: null,
    fields: [],
  };
}

const ids = (rows: Ticket[]) => rows.map((row) => row.id);

describe("arrangeLanes", () => {
  const tickets = [ticket("a", "todo"), ticket("b", "doing"), ticket("c", "todo")];

  it("keeps the board's order in every column", () => {
    const lanes = arrangeLanes(tickets);
    expect(ids(lanes.todo)).toEqual(["a", "c"]);
    expect(ids(lanes.doing)).toEqual(["b"]);
    expect(lanes.closed).toEqual([]);
  });

  it("puts a card placed in another column at the top there", () => {
    const lanes = arrangeLanes(tickets, { c: "doing" });
    expect(ids(lanes.todo)).toEqual(["a"]);
    expect(ids(lanes.doing)).toEqual(["c", "b"]);
  });

  it("leaves a card placed back in its own column where it was", () => {
    expect(ids(arrangeLanes(tickets, { c: "todo" }).todo)).toEqual(["a", "c"]);
  });
});

describe("laneForKey", () => {
  it("steps one column left or right and stops at the ends", () => {
    expect(laneForKey("ArrowRight", "todo")).toBe("doing");
    expect(laneForKey("ArrowLeft", "doing")).toBe("todo");
    expect(laneForKey("ArrowLeft", "todo")).toBe("todo");
    expect(laneForKey("ArrowRight", "closed")).toBe("closed");
  });

  it("ignores other keys", () => {
    expect(laneForKey("ArrowDown", "todo")).toBeNull();
    expect(laneForKey("KeyA", "todo")).toBeNull();
  });
});

describe("placeSaved", () => {
  it("replaces the moved ticket with the saved one at the top", () => {
    const saved = { ...ticket("c", "done"), updatedAt: "2026-10-11T10:00:00Z" };
    const next = placeSaved([ticket("a", "todo"), ticket("c", "todo")], saved);
    expect(next.map((row) => [row.id, row.status])).toEqual([
      ["c", "done"],
      ["a", "todo"],
    ]);
  });
});
