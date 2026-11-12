import type { BoardEvent } from "@corvo/contracts";

/** What each agent is doing on a ticket right now: ticket id to its latest step. */
export type BoardSteps = ReadonlyMap<string, string>;

/** A signal that names a step sets it on its ticket; one that ends it (null) clears it. */
export function applyBoardStep(steps: BoardSteps, event: BoardEvent): BoardSteps {
  if (!event.ticketId || event.step === undefined) return steps;
  const next = new Map(steps);
  if (event.step === null) next.delete(event.ticketId);
  else next.set(event.ticketId, event.step.text);
  return next;
}

/** Only a signal that moved a ticket or says nothing about a step needs the list read again. */
export function boardEventChangesList(event: BoardEvent): boolean {
  return event.step === undefined || event.moved !== undefined;
}
