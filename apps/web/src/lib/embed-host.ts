import type {
  HostAction,
  HostActionOutcome,
  HostActionResult,
  HostContext,
  HostTurn,
} from "@corvo/contracts";
import { useSyncExternalStore } from "react";
import { tellParent } from "./embed";

/**
 * What the partner's page has told the frame: where the person is, the actions the page can carry
 * out, and what the last of them did. It lives in memory for the frame's life and goes to the
 * server with the next message, where it is limited again and read by the agent as data.
 */
interface HostState {
  context: HostContext | null;
  actions: HostAction[];
  results: HostActionResult[];
}

let state: HostState = { context: null, actions: [], results: [] };
const listeners = new Set<() => void>();
/** How a line the page or a card adds to the chat is sent: `hostResult` makes it a system line. */
export interface HostAskOptions {
  hostResult?: { outcome: HostActionOutcome };
}
type AskListener = (text: string, options?: HostAskOptions) => void;
const asks = new Set<AskListener>();
const early: Array<{ text: string; options?: HostAskOptions }> = [];
const pending = new Map<string, (answer: { ok: boolean; result?: string }) => void>();

function set(next: Partial<HostState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const hostState = () => state;

export function useHostContext(): HostContext | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state.context,
  );
}

export function setHostContext(context: HostContext | null) {
  set({ context });
}

export function setHostActions(actions: HostAction[]) {
  set({ actions });
}

/** The page's words for the next message; results are sent once, then forgotten. */
export function takeHostTurn(): HostTurn | undefined {
  const { context, actions, results } = state;
  if (!context && actions.length === 0 && results.length === 0) return undefined;
  if (results.length) set({ results: [] });
  return {
    ...(context ? { context } : {}),
    ...(actions.length ? { actions } : {}),
    ...(results.length ? { results } : {}),
  };
}

/** The person asked something in the page's own box; the chat sends it as their message. */
export function onHostAsk(listener: AskListener): () => void {
  asks.add(listener);
  // A question that came while the chat was still loading is sent now.
  for (const item of early.splice(0)) listener(item.text, item.options);
  return () => asks.delete(listener);
}

export function hostAsk(text: string, options?: HostAskOptions) {
  if (asks.size === 0) early.push({ text, options });
  for (const listener of asks) listener(text, options);
}

const ACTION_TIMEOUT_MS = 30_000;

/**
 * Hands a confirmed action to the page and waits for how it went. A page that never answers is a
 * failed action, not a card stuck waiting.
 */
export function runHostAction(card: {
  actionId: string;
  name: string;
  params: Record<string, string | number | boolean>;
}): Promise<{ outcome: Exclude<HostActionOutcome, "denied">; result?: string }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(card.actionId);
      resolve({ outcome: "failed" });
    }, ACTION_TIMEOUT_MS);
    pending.set(card.actionId, (answer) => {
      window.clearTimeout(timer);
      pending.delete(card.actionId);
      resolve({ outcome: answer.ok ? "done" : "failed", result: answer.result });
    });
    tellParent({ type: "corvo:action", id: card.actionId, name: card.name, params: card.params });
  });
}

export function answerHostAction(id: string, answer: { ok: boolean; result?: string }) {
  pending.get(id)?.(answer);
}

/** Remembers what an action did so the agent hears it with the next message. */
export function rememberHostResult(result: HostActionResult) {
  set({ results: [...state.results, result].slice(-5) });
}

export function resetHostForTests() {
  state = { context: null, actions: [], results: [] };
  listeners.clear();
  asks.clear();
  early.length = 0;
  pending.clear();
}
