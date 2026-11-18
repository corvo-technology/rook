import { can, knownSpacePermissions } from "@corvo/core";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "./query";

/**
 * The partners this organization is a member of, for people who manage them. Empty for everyone
 * else, so what exists only for partners (the Partnership connection, the partner agents) simply
 * does not show.
 */
export function usePartnerNames(): string[] {
  const queries = useSpaceQueries();
  const roles = useQuery(queries.spaces.roles.list.queryOptions());
  const manages = roles.data
    ? can(
        {
          isOwner: roles.data.me.isOwner,
          permissions: knownSpacePermissions(roles.data.me.permissions),
        },
        "manage_partner",
      )
    : false;
  const partners = useQuery({
    ...queries.partnerConsole.partners.queryOptions(),
    enabled: manages,
    retry: false,
  });
  return partners.data?.map((partner) => partner.name) ?? [];
}
