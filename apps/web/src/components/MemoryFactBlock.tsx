import type { UserMemory } from "@corvo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSpaceRpc } from "../lib/space-rpc";
import { MemoryFactCard } from "./MemoryFactCard";

/**
 * The card for a fact an agent kept about the person. The message only names the fact; what state
 * it is in is asked of the server each time, and only its person can see it, so anyone else sees nothing.
 */
export function MemoryFactBlock({ memoryId }: { memoryId: string }) {
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const key = ["you", "memory", memoryId];
  const memory = useQuery({
    queryKey: key,
    queryFn: () => rpc.you.get({ memoryId }),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (decision: "save" | "discard" | "forget") => rpc.you.decide({ memoryId, decision }),
    onSuccess: (next: UserMemory | null) => {
      if (next) queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: ["you"] });
    },
    // Someone may have answered first: show what the server says now.
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  if (!memory.data) return null;
  return (
    <MemoryFactCard
      memory={memory.data}
      busy={decide.isPending}
      onDecide={(decision) => decide.mutate(decision)}
    />
  );
}
