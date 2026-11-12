import type { BoardEvent } from "@corvo/contracts";
import { expect, it } from "vitest";
import { applyBoardStep, boardEventChangesList } from "./board-steps";

const base = { spaceId: "s", ticketId: "t1", createdAt: "2026-01-01T00:00:00.000Z" };
const step = { botId: "b1", text: "Searching the web" };

it("shows the latest step of a ticket and replaces it with the next", () => {
  const first = applyBoardStep(new Map(), { ...base, step });
  expect(first.get("t1")).toBe("Searching the web");
  const next = applyBoardStep(first, { ...base, step: { ...step, text: "Writing the reply" } });
  expect(next.get("t1")).toBe("Writing the reply");
});

it("clears the step when the run ends, leaving other tickets alone", () => {
  const steps = new Map([
    ["t1", "Searching the web"],
    ["t2", "Reading"],
  ]);
  const cleared = applyBoardStep(steps, { ...base, step: null });
  expect(cleared.has("t1")).toBe(false);
  expect(cleared.get("t2")).toBe("Reading");
});

it("ignores a signal with no step or no ticket", () => {
  const steps = new Map([["t1", "Reading"]]);
  expect(applyBoardStep(steps, { ...base })).toBe(steps);
  expect(applyBoardStep(steps, { ...base, ticketId: undefined, step })).toBe(steps);
});

it("reads the list again for every signal except a bare step", () => {
  const plain: BoardEvent = { ...base };
  expect(boardEventChangesList(plain)).toBe(true);
  expect(boardEventChangesList({ ...base, step })).toBe(false);
  expect(boardEventChangesList({ ...base, step: null })).toBe(false);
  expect(
    boardEventChangesList({
      ...base,
      step: null,
      moved: {
        ref: "RAK-1",
        title: "x",
        status: "review",
        previousStatus: "doing",
        byBotId: "b1",
        byName: "Ana",
      },
    }),
  ).toBe(true);
});
