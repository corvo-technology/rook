import { runSpaceStream } from "@corvo/core";
import { useEffect } from "react";
import { computerUpdates } from "./computer-updates";
import type { createSpaceRpc } from "./rpc";
import { emitSpaceHint, onSpaceHint } from "./space-hints";

/**
 * One server-sent stream for the whole space, in place of a timer per list. It carries only hints
 * that something changed; each list reads itself again through its permission-checked call.
 */
export function useSpaceStream(rpc: ReturnType<typeof createSpaceRpc>): void {
  useEffect(() => {
    const abort = new AbortController();
    const stopComputer = onSpaceHint("computer", () => computerUpdates.refresh());
    void runSpaceStream({
      signal: abort.signal,
      subscribe: (signal) => rpc.spaces.subscribe(undefined, { signal }),
      onHint: emitSpaceHint,
    });
    return () => {
      abort.abort();
      stopComputer();
    };
  }, [rpc]);
}
