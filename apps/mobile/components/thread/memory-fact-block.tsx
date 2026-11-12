import type { UserMemory } from "@corvo/contracts";
import { useCallback, useEffect, useState } from "react";
import { decideYouMemory, getYouMemory } from "../../lib/you-memory";
import { MemoryFactCard } from "../you-memory-views";

/**
 * The card for a fact an agent kept about the person. The message only names the fact; its state is
 * asked of the server each time, and only its person can read it, so anyone else sees nothing.
 */
export function MemoryFactBlock({ memoryId }: { memoryId: string }) {
  const [memory, setMemory] = useState<UserMemory | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemory(await getYouMemory(memoryId));
    } catch {
      setMemory(null);
    }
  }, [memoryId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!memory) return null;
  return (
    <MemoryFactCard
      memory={memory}
      busy={busy}
      onDecide={(decision) => {
        if (busy) return;
        setBusy(true);
        void decideYouMemory(memoryId, decision)
          .then((next) => (next ? setMemory(next) : setMemory(null)))
          // Someone may have answered first: show what the server says now.
          .catch(load)
          .finally(() => setBusy(false));
      }}
    />
  );
}
