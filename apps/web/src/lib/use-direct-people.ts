import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";

const REFRESH_MS = 5_000;

/** The space's other members and their conversations with this person, with unread kept fresh. */
export function useDirectPeople() {
  const queries = useSpaceQueries();
  return useQuery({
    ...queries.directMessages.people.queryOptions({ input: {} }),
    refetchInterval: REFRESH_MS,
  });
}
