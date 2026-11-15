import { SPACE_FALLBACK_REFETCH_MS } from "@corvo/core";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";
import { useSpaceHint } from "./space-hints";

/** The approvals waiting on this person, across every chat; the count follows the list. */
export function usePendingApprovals() {
  const queries = useSpaceQueries();
  const query = useQuery({
    ...queries.approvals.list.queryOptions({ input: {} }),
    refetchInterval: SPACE_FALLBACK_REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  useSpaceHint("approvals", () => void query.refetch());
  return query;
}
