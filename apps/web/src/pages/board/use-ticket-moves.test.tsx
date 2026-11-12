// @vitest-environment jsdom

import type { Ticket, TicketStatus } from "@corvo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Placement } from "./board-drag";
import { useTicketMoves } from "./use-ticket-moves";

const ticket = { id: "t1", status: "todo" } as Ticket;

type Save = (move: { id: string; status: TicketStatus }) => Promise<Ticket>;

let view: { placement: Placement; move: (ticket: Ticket, status: TicketStatus) => Promise<void> };
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

function Harness(props: Parameters<typeof useTicketMoves>[0]) {
  view = useTicketMoves(props);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function mount(save: Save, onSaved = vi.fn(async () => {}), onError = vi.fn()) {
  await act(async () => root.render(<Harness save={save} onSaved={onSaved} onError={onError} />));
  return { onSaved, onError };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("shows the move at once and keeps it until the save is written", async () => {
  const answer = deferred<Ticket>();
  const { onSaved, onError } = await mount(() => answer.promise);
  let done!: Promise<void>;
  await act(async () => {
    done = view.move(ticket, "doing");
  });
  expect(view.placement).toEqual({ t1: "doing" });
  const saved = { ...ticket, status: "doing" } as Ticket;
  await act(async () => {
    answer.resolve(saved);
    await done;
  });
  expect(onSaved).toHaveBeenCalledWith(saved);
  expect(onError).not.toHaveBeenCalled();
  expect(view.placement).toEqual({});
});

it("puts a refused move back and reports why", async () => {
  const refusal = new Error("No access");
  const { onSaved, onError } = await mount(() => Promise.reject(refusal));
  await act(async () => view.move(ticket, "done"));
  expect(view.placement).toEqual({});
  expect(onError).toHaveBeenCalledWith(refusal);
  expect(onSaved).not.toHaveBeenCalled();
});

it("lets only the latest move of a ticket settle it", async () => {
  const first = deferred<Ticket>();
  const second = deferred<Ticket>();
  const save = vi.fn<Save>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { onSaved, onError } = await mount(save);
  let a!: Promise<void>;
  let b!: Promise<void>;
  await act(async () => {
    a = view.move(ticket, "doing");
  });
  await act(async () => {
    b = view.move(ticket, "review");
  });
  // The first move is refused after the second was made: the card stays where it was dropped last.
  await act(async () => {
    first.reject(new Error("Stale"));
    await a;
  });
  expect(onError).not.toHaveBeenCalled();
  expect(view.placement).toEqual({ t1: "review" });
  await act(async () => {
    second.resolve({ ...ticket, status: "review" } as Ticket);
    await b;
  });
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(view.placement).toEqual({});
});
