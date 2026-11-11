import type { TourState } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { dueMark, fulfilledMarks, parseTourDone, type TourFacts } from "./coach-tour.js";

const none: TourFacts = {
  draftWaiting: false,
  personSent: false,
  replied: false,
  askWaiting: false,
  hasChief: false,
  inChiefChat: false,
  missionsListed: false,
};
const fresh: TourState = { done: [], skipped: false };
const facts = (over: Partial<TourFacts>): TourFacts => ({ ...none, ...over });

describe("dueMark", () => {
  it("is null with no facts, no tour or a skipped tour", () => {
    expect(dueMark(fresh, none)).toBeNull();
    expect(dueMark(null, facts({ askWaiting: true }))).toBeNull();
    expect(dueMark(undefined, facts({ askWaiting: true }))).toBeNull();
    expect(dueMark({ done: [], skipped: true }, facts({ askWaiting: true }))).toBeNull();
  });

  it("shows first only while nothing has been sent", () => {
    expect(dueMark(fresh, facts({ draftWaiting: true }))).toBe("first");
    expect(dueMark(fresh, facts({ draftWaiting: true, personSent: true }))).toBeNull();
  });

  it("puts ask before first", () => {
    expect(dueMark(fresh, facts({ askWaiting: true, draftWaiting: true }))).toBe("ask");
  });

  it("shows chief after a reply outside the Chief's chat", () => {
    expect(dueMark(fresh, facts({ hasChief: true, replied: true }))).toBe("chief");
    expect(dueMark(fresh, facts({ hasChief: true, replied: true, inChiefChat: true }))).toBeNull();
    expect(dueMark(fresh, facts({ hasChief: false, replied: true }))).toBeNull();
  });

  it("shows missions after chief is done, or when there is no Chief", () => {
    const f = facts({ missionsListed: true, replied: true, hasChief: true });
    expect(dueMark(fresh, f)).toBe("chief");
    expect(dueMark({ done: ["chief"], skipped: false }, f)).toBe("missions");
    expect(dueMark(fresh, facts({ missionsListed: true, replied: true }))).toBe("missions");
  });

  it("never shows a done mark", () => {
    expect(dueMark({ done: ["ask"], skipped: false }, facts({ askWaiting: true }))).toBeNull();
  });
});

describe("fulfilledMarks", () => {
  it("records first and chief whether or not they showed", () => {
    expect(fulfilledMarks(fresh, facts({ personSent: true, inChiefChat: true }), null)).toEqual([
      "first",
      "chief",
    ]);
  });

  it("records ask only after it showed and no ask is left", () => {
    expect(fulfilledMarks(fresh, facts({ askWaiting: false }), "ask")).toEqual(["ask"]);
    expect(fulfilledMarks(fresh, facts({ askWaiting: false }), null)).toEqual([]);
    expect(fulfilledMarks(fresh, facts({ askWaiting: true }), "ask")).toEqual([]);
  });

  it("skips marks already done and skipped tours", () => {
    expect(
      fulfilledMarks({ done: ["first"], skipped: false }, facts({ personSent: true }), null),
    ).toEqual([]);
    expect(fulfilledMarks({ done: [], skipped: true }, facts({ personSent: true }), null)).toEqual(
      [],
    );
    expect(fulfilledMarks(null, facts({ personSent: true }), null)).toEqual([]);
  });
});

describe("parseTourDone", () => {
  it("keeps known marks once each, in order", () => {
    expect(parseTourDone(["chief", "bogus", "first", "chief"])).toEqual(["first", "chief"]);
  });
});
