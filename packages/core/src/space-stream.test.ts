import type { SpaceHint, SpaceHintKind } from "@corvo/contracts";
import { SPACE_HINT_KINDS } from "@corvo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceStream, SPACE_STREAM_IDLE_MS } from "./space-stream.js";

function stream() {
  const queue: SpaceHint[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(kind: SpaceHint["kind"]) {
      queue.push({ kind, createdAt: "now" });
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const next = queue.shift();
          if (next) yield next;
          else if (closed) return;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      },
    } as AsyncIterable<SpaceHint>,
  };
}

describe("space stream client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks every list to refresh once on connect, then once per hint, and ignores heartbeats", async () => {
    const live = stream();
    const hints: SpaceHintKind[] = [];
    const abort = new AbortController();
    void runSpaceStream({
      signal: abort.signal,
      subscribe: async () => live.iterable,
      onHint: (kind) => hints.push(kind),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(hints).toEqual([...SPACE_HINT_KINDS]);
    hints.length = 0;
    live.push("heartbeat");
    live.push("approvals");
    await vi.advanceTimersByTimeAsync(0);
    expect(hints).toEqual(["approvals"]);
    abort.abort();
  });

  it("refreshes everything again after the stream drops and reconnects", async () => {
    const first = stream();
    const second = stream();
    const sources = [first, second];
    const hints: SpaceHintKind[] = [];
    const abort = new AbortController();
    void runSpaceStream({
      signal: abort.signal,
      subscribe: async () => sources.shift()!.iterable,
      onHint: (kind) => hints.push(kind),
    });
    await vi.advanceTimersByTimeAsync(0);
    hints.length = 0;
    first.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hints).toEqual([...SPACE_HINT_KINDS]);
    abort.abort();
  });

  it("treats a stream with no frame at all as half-open and reconnects", async () => {
    const subscribe = vi.fn(async () => stream().iterable);
    const abort = new AbortController();
    void runSpaceStream({ signal: abort.signal, subscribe, onHint: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SPACE_STREAM_IDLE_MS + 1_000);
    expect(subscribe).toHaveBeenCalledTimes(2);
    abort.abort();
  });

  it("stops when the server refuses instead of asking again", async () => {
    const subscribe = vi.fn(async () => {
      throw Object.assign(new Error("signed out"), { status: 401, code: "UNAUTHORIZED" });
    });
    const abort = new AbortController();
    const done = runSpaceStream({ signal: abort.signal, subscribe, onHint: () => {} });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
