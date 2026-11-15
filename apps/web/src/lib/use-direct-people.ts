import { SPACE_FALLBACK_REFETCH_MS } from "@corvo/core";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";
import { useSpaceHint } from "./space-hints";

/** The space's other members and their conversations with this person, with unread kept fresh. */
export function useDirectPeople() {
  const queries = useSpaceQueries();
  const query = useQuery({
    ...queries.directMessages.people.queryOptions({ input: {} }),
    refetchInterval: SPACE_FALLBACK_REFETCH_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  useSpaceHint("dm", () => void query.refetch());
  return query;
}
