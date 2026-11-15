import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";

const REFRESH_MS = 4_000;

/** The approvals waiting on this person, across every chat; the count follows the list. */
export function usePendingApprovals() {
  const queries = useSpaceQueries();
  return useQuery({
    ...queries.approvals.list.queryOptions({ input: {} }),
    refetchInterval: REFRESH_MS,
  });
}
