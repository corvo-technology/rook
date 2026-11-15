import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";

/** How many people see a channel: those added to a private one, else the whole space. */
export function useChannelPeopleCount(groupId: string | undefined): number | undefined {
  const queries = useSpaceQueries();
  const members = useQuery(queries.spaces.members.list.queryOptions({ input: {} })).data;
  const people = useQuery({
    ...queries.groups.people.list.queryOptions({ input: { groupId: groupId ?? "" } }),
    enabled: Boolean(groupId),
  }).data;
  if (!groupId || !members || !people) return undefined;
  return people.restricted ? people.userIds.length : members.length;
}
