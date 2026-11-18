import { can, isRetryableError, knownSpacePermissions } from "@corvo/core";
import { fetchFresh } from "@corvo/core/query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSpaceQueries } from "../../lib/query";
import { usePartnerNames } from "../../lib/use-partners";
import type { ConnectionItem } from "./connection-model";
import { databaseItem, lendableBots, mailboxItem, mcpItem, partnerItem } from "./connection-model";

/** How often the list is re-read while a server installs its package or is being tested. */
const INSTALL_POLL_MS = 2500;

/** Every connection the member may see, who may use each, and the agents they can be lent to. */
export function useConnections({ testing = false }: { testing?: boolean } = {}) {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const roles = useQuery(queries.spaces.roles.list.queryOptions());
  const canManage = roles.data
    ? can(
        {
          isOwner: roles.data.me.isOwner,
          permissions: knownSpacePermissions(roles.data.me.permissions),
        },
        "manage_connections",
      )
    : false;
  const serversOptions = queries.mcp.servers.list.queryOptions({ input: { scope: "space" } });
  const servers = useQuery({
    ...serversOptions,
    // A freshly saved stdio server installs its package in the background, so its health moves on
    // its own; follow it, and stop on a refusal.
    refetchInterval: (query) => {
      const error = query.state.error;
      if (error && !isRetryableError(error)) return false;
      const installing = query.state.data?.some((server) => server.health.status === "installing");
      return testing || installing ? INSTALL_POLL_MS : false;
    },
  });
  const mailboxesOptions = queries.mailboxes.list.queryOptions();
  const mailboxes = useQuery(mailboxesOptions);
  // Databases are listed only to people who manage connections, as before.
  const databasesOptions = queries.databases.list.queryOptions();
  const databases = useQuery({ ...databasesOptions, enabled: canManage });
  const partnerNames = usePartnerNames();
  const accessOptions = queries.access.list.queryOptions();
  const access = useQuery(accessOptions);
  const botsOptions = queries.bots.list.queryOptions();
  const bots = useQuery(botsOptions);

  const items = useMemo<ConnectionItem[]>(
    () => [
      ...(servers.data ?? []).map(mcpItem),
      ...(databases.data ?? []).map(databaseItem),
      ...(mailboxes.data ?? []).map(mailboxItem),
      ...(partnerNames.length > 0 ? [partnerItem(partnerNames)] : []),
    ],
    [servers.data, databases.data, mailboxes.data, partnerNames],
  );

  async function refresh() {
    await Promise.all([
      fetchFresh(queryClient, serversOptions),
      fetchFresh(queryClient, mailboxesOptions),
      fetchFresh(queryClient, accessOptions),
      fetchFresh(queryClient, botsOptions),
      ...(canManage ? [fetchFresh(queryClient, databasesOptions)] : []),
    ]);
  }

  return {
    items,
    access: access.data ?? [],
    agents: lendableBots(bots.data ?? []),
    canManage,
    failed: servers.isError || mailboxes.isError || access.isError,
    serversOptions,
    refresh,
  };
}
