import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { highestRole } from "./channel-people-groups";
import { useSpaceQueries } from "./query";

/** What a person is called in the space beside their name: "Owner", or their highest role. */
export function usePersonRoles(): (userId: string | undefined) => string | undefined {
  const queries = useSpaceQueries();
  const members = useQuery(queries.spaces.members.list.queryOptions({ input: {} })).data;
  const roles = useQuery(queries.spaces.roles.list.queryOptions({ input: {} })).data?.roles;
  return useCallback(
    (userId) => {
      const member = members?.find((item) => item.userId === userId);
      if (!member || !roles) return undefined;
      const role = highestRole(member, roles);
      return role === "owner" ? t`Owner` : role?.name;
    },
    [members, roles],
  );
}
