import { isRunWorking } from "@corvo/core";
import { Spinner } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { useSpaceQueries } from "../lib/query";
import { buildTeamRoster, TICKET_WORK_STATUSES, ticketsByOwner } from "../lib/team-roster";
import { TeamBoard } from "./TeamBoard";
import { WindowChrome } from "./WindowChrome";

const FAST_REFRESH_MS = 2_500;
const IDLE_REFRESH_MS = 15_000;

/** The whole company on one screen: each team, who is in it, and who is working right now. */
export function TeamPage() {
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const bootstrap = useQuery({
    queryKey: queries.bootstrap.queryKey({ input: {} }),
    queryFn: () => takeInitialBootstrap(),
    refetchInterval: (query) =>
      query.state.data?.bots.some((bot) => isRunWorking(bot.status))
        ? FAST_REFRESH_MS
        : IDLE_REFRESH_MS,
  });
  const roster = useMemo(
    () => buildTeamRoster(bootstrap.data?.bots ?? [], bootstrap.data?.groups ?? []),
    [bootstrap.data],
  );

  // The board is optional, so its tickets are only asked for when it is on.
  const boardOn = Boolean(bootstrap.data?.me?.ticketBoardEnabled);
  const ticketsQuery = useQuery(
    queries.tickets.list.queryOptions({
      input: boardOn ? { statuses: [...TICKET_WORK_STATUSES] } : skipToken,
      refetchInterval: IDLE_REFRESH_MS,
    }),
  );
  const tickets = useMemo(
    () => ticketsByOwner(ticketsQuery.data?.tickets ?? []),
    [ticketsQuery.data],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <div className="app-drag flex items-center gap-2 px-4 pt-3">
        <WindowChrome />
      </div>
      <h1 className="mx-auto w-full max-w-3xl px-6 py-4 text-xl font-light tracking-tight">
        <Trans>Team</Trans>
      </h1>
      {bootstrap.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : null}
      <div className="w-full px-6 pb-8">
        <TeamBoard roster={roster} tickets={tickets} onOpen={(path) => navigate(path)} />
      </div>
    </div>
  );
}
