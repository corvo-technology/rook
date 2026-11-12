import type { WikiChange } from "@corvo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useSpaceRpc } from "../lib/space-rpc";
import { WikiChangeCard } from "./WikiChangeCard";

/**
 * The card for a change the wiki kept from this conversation. The message only names the change;
 * what state it is in, and what the reader may see of its source, is asked of the server each time.
 */
export function WikiChangeBlock({ changeId }: { changeId: string }) {
  const rpc = useSpaceRpc();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = ["wiki", "change", changeId];
  const retry = useMutation({ mutationFn: () => rpc.wiki.changes.retry({ changeId }) });
  // The rewrite runs in the background: look again until the change is out of conflict.
  const change = useQuery({
    queryKey: key,
    queryFn: () => rpc.wiki.changes.get({ changeId }),
    refetchInterval: (query) =>
      retry.isSuccess && query.state.data?.state === "conflict" ? 4_000 : false,
  });
  const decide = useMutation({
    mutationFn: (decision: "apply" | "refuse" | "undo") =>
      rpc.wiki.changes.decide({ changeId, decision }),
    onSuccess: (next: WikiChange) => {
      queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
    },
  });
  if (!change.data) return null;
  return (
    <WikiChangeCard
      change={change.data}
      busy={
        decide.isPending || retry.isPending || (retry.isSuccess && change.data.state === "conflict")
      }
      onDecide={(decision) => decide.mutate(decision)}
      onRetry={() => retry.mutate()}
      onOpenPage={(title) => navigate(`/app/wiki?page=${encodeURIComponent(title)}`)}
    />
  );
}
