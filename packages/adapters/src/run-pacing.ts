import type { RunContext } from "./run-context.js";

export const PACING_MIN_MS = 800;
export const PACING_MAX_MS = 2500;
const PACING_PER_CHAR_MS = 25;

/** How long a short message takes to "type": longer text waits longer, within human bounds. */
export function pacingDelayMs(text: string): number {
  return Math.min(PACING_MAX_MS, Math.max(PACING_MIN_MS, text.length * PACING_PER_CHAR_MS));
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Spaces consecutive bot messages of one run like a person typing them. The first message goes
 * out at once; each later one waits until its own delay has passed since the previous.
 */
export async function paceBotMessage(ctx: RunContext, text: string): Promise<void> {
  const { reply } = ctx.state;
  const now = ctx.deps.pacing?.now ?? Date.now;
  const sleep = ctx.deps.pacing?.sleep ?? defaultSleep;
  if (reply.lastBotMessageAt) {
    const wait = reply.lastBotMessageAt + pacingDelayMs(text) - now();
    if (wait > 0) await sleep(wait, ctx.abortController.signal);
  }
  reply.lastBotMessageAt = now();
}
