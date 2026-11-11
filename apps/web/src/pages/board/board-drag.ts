import type { Ticket, TicketStatus } from "@corvo/contracts";
import { TICKET_STATUSES } from "@corvo/contracts";

/** Where tickets show while a move is out or a drag hovers a column: ticket id to column. */
export type Placement = Readonly<Record<string, TicketStatus>>;

/**
 * The tickets of each column, in the order the board sends them. A ticket placed in a column other
 * than its saved one goes to the top there, where the board's newest-first order puts it once the
 * move is saved.
 */
export function arrangeLanes(
  tickets: readonly Ticket[],
  placement: Placement = {},
): Record<TicketStatus, Ticket[]> {
  const stay = emptyLanes();
  const moved = emptyLanes();
  for (const ticket of tickets) {
    const status = placement[ticket.id] ?? ticket.status;
    (status === ticket.status ? stay : moved)[status].push(ticket);
  }
  for (const status of TICKET_STATUSES) stay[status] = [...moved[status], ...stay[status]];
  return stay;
}

function emptyLanes(): Record<TicketStatus, Ticket[]> {
  return Object.fromEntries(TICKET_STATUSES.map((status) => [status, []])) as unknown as Record<
    TicketStatus,
    Ticket[]
  >;
}

/** The column a left or right arrow key moves a held card to; null for any other key. */
export function laneForKey(code: string, current: TicketStatus): TicketStatus | null {
  const step = code === "ArrowRight" ? 1 : code === "ArrowLeft" ? -1 : 0;
  if (step === 0) return null;
  const at = TICKET_STATUSES.indexOf(current) + step;
  return TICKET_STATUSES[Math.min(TICKET_STATUSES.length - 1, Math.max(0, at))] ?? current;
}

/** The list after a saved move: the ticket the board returned replaces the old one, at the top. */
export function placeSaved(tickets: readonly Ticket[], saved: Ticket): Ticket[] {
  return [saved, ...tickets.filter((ticket) => ticket.id !== saved.id)];
}
