import type { Ticket, TicketStatus } from "@corvo/contracts";
import { useRef, useState } from "react";
import type { Placement } from "./board-drag";

/**
 * Moves a ticket to another column at once and keeps it there while the board saves the move.
 * A refused move puts the card back where it was and reports why.
 */
export function useTicketMoves({
  save,
  onSaved,
  onError,
}: {
  save: (move: { id: string; status: TicketStatus }) => Promise<Ticket>;
  onSaved: (saved: Ticket) => Promise<void>;
  onError: (cause: unknown) => void;
}): { placement: Placement; move: (ticket: Ticket, status: TicketStatus) => Promise<void> } {
  const [placement, setPlacement] = useState<Placement>({});
  // Only the latest move of a ticket clears its placement, so an older answer cannot undo a newer drop.
  const latest = useRef(new Map<string, number>());
  const turn = useRef(0);

  async function move(ticket: Ticket, status: TicketStatus) {
    const id = ticket.id;
    turn.current += 1;
    const mine = turn.current;
    latest.current.set(id, mine);
    setPlacement((current) => ({ ...current, [id]: status }));
    try {
      const saved = await save({ id, status });
      if (latest.current.get(id) === mine) await onSaved(saved);
    } catch (cause) {
      if (latest.current.get(id) === mine) onError(cause);
    } finally {
      if (latest.current.get(id) === mine) {
        latest.current.delete(id);
        setPlacement(({ [id]: _settled, ...rest }) => rest);
      }
    }
  }

  return { placement, move };
}
