import { TOUR_MARKS, type TourMark, type TourState } from "@corvo/contracts";

/** What the client already knows about the open chat and the shell. */
export type TourFacts = {
  /** The open bot chat had a non-empty composer draft when it opened. */
  draftWaiting: boolean;
  /** The person has sent a message in the open chat. */
  personSent: boolean;
  /** The open chat has a bot message after a person message. */
  replied: boolean;
  /** The open chat has an ask the person can answer now. */
  askWaiting: boolean;
  hasChief: boolean;
  inChiefChat: boolean;
  missionsListed: boolean;
};

function isDue(mark: TourMark, tour: TourState, facts: TourFacts): boolean {
  switch (mark) {
    case "ask":
      return facts.askWaiting;
    case "first":
      return facts.draftWaiting && !facts.personSent;
    case "chief":
      return facts.hasChief && facts.replied && !facts.inChiefChat;
    case "missions":
      return (
        facts.missionsListed && facts.replied && (!facts.hasChief || tour.done.includes("chief"))
      );
  }
}

/** The one mark to show now, or null. */
export function dueMark(tour: TourState | null | undefined, facts: TourFacts): TourMark | null {
  if (!tour || tour.skipped) return null;
  return TOUR_MARKS.find((mark) => !tour.done.includes(mark) && isDue(mark, tour, facts)) ?? null;
}

/** Pending marks whose moment has passed and that should be recorded as done. */
export function fulfilledMarks(
  tour: TourState | null | undefined,
  facts: TourFacts,
  showing: TourMark | null,
): TourMark[] {
  if (!tour || tour.skipped) return [];
  const fulfilled: Record<TourMark, boolean> = {
    ask: showing === "ask" && !facts.askWaiting,
    first: facts.personSent,
    chief: facts.inChiefChat,
    missions: false,
  };
  return TOUR_MARKS.filter((mark) => !tour.done.includes(mark) && fulfilled[mark]);
}

/** Keeps the marks this release knows, once each; a newer release may have stored others. */
export function parseTourDone(values: readonly string[]): TourMark[] {
  return TOUR_MARKS.filter((mark) => values.includes(mark));
}
