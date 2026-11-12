import type { RealtimeFanout } from "@corvo/adapter-kit";
import type { BoardEvent, BoardMove, BoardStep } from "@corvo/contracts";
import { BoardMoveSchema, BoardStepSchema } from "@corvo/contracts";

/** A transient "this board changed" signal. Clients refetch the list on any frame. */
export interface BoardEvents {
  notify(
    spaceId: string,
    change?: {
      boardId?: string;
      ticketId?: string;
      moved?: BoardMove;
      step?: BoardStep | null;
    },
  ): Promise<void>;
  follow(spaceId: string, signal?: AbortSignal): AsyncGenerator<BoardEvent>;
}

export function boardEventTopic(spaceId: string): string {
  return `board:${spaceId}`;
}

/**
 * Build the board notifier and the subscription stream. Without a realtime
 * fanout the notifier does nothing and the stream stays open and empty.
 */
export function createBoardEvents(realtime?: RealtimeFanout): BoardEvents {
  return {
    async notify(spaceId, change) {
      const payload: BoardEvent = {
        spaceId,
        ...(change?.boardId ? { boardId: change.boardId } : {}),
        ...(change?.ticketId ? { ticketId: change.ticketId } : {}),
        ...(change?.moved ? { moved: change.moved } : {}),
        ...(change?.step !== undefined ? { step: change.step } : {}),
        createdAt: new Date().toISOString(),
      };
      await realtime
        ?.publish(boardEventTopic(spaceId), JSON.stringify(payload))
        .catch(() => undefined);
    },
    async *follow(spaceId, signal) {
      const queue: BoardEvent[] = [];
      const waiters = new Set<() => void>();
      const push = (event: BoardEvent) => {
        queue.push(event);
        for (const wake of [...waiters]) wake();
      };
      const unsubscribe = realtime
        ? await realtime
            .subscribe(boardEventTopic(spaceId), (payload) => {
              let change: { boardId?: string; ticketId?: string; moved?: unknown; step?: unknown } =
                {};
              try {
                change = JSON.parse(payload) as typeof change;
              } catch {
                change = {};
              }
              const moved = BoardMoveSchema.safeParse(change.moved);
              const step = BoardStepSchema.nullable().safeParse(change.step);
              push({
                spaceId,
                ...(change.boardId ? { boardId: change.boardId } : {}),
                ...(change.ticketId ? { ticketId: change.ticketId } : {}),
                ...(moved.success ? { moved: moved.data } : {}),
                ...(step.success && step.data !== undefined ? { step: step.data } : {}),
                createdAt: new Date().toISOString(),
              });
            })
            .catch(() => async () => {})
        : async () => {};
      try {
        while (!signal?.aborted) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            const wake = () => {
              waiters.delete(wake);
              signal?.removeEventListener("abort", wake);
              resolve();
            };
            waiters.add(wake);
            signal?.addEventListener("abort", wake, { once: true });
            if (signal?.aborted) wake();
          });
        }
      } finally {
        waiters.clear();
        await unsubscribe();
      }
    },
  };
}
