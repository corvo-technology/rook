import type { AppBootstrap, MissionsView, NavPart } from "@corvo/contracts";
import { NAV_PARTS } from "@corvo/contracts";
import { missionsVisible, newParts, partShows } from "@corvo/core";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useSpaceQueries } from "./query";
import { railSection } from "./rail-section";

/** Shown until the first answer arrives, so the bar never flashes full: only the open page shows. */
const LOADING: MissionsView = { short: true, completed: [], has: [], seen: [] };

function isNavPart(value: string | null): value is NavPart {
  return NAV_PARTS.includes(value as NavPart);
}

/** The part of the navigation the current page belongs to, if it is a gated one. */
function currentPart(pathname: string, search: string): NavPart | null {
  const section = railSection(pathname, search);
  if (isNavPart(section)) return section;
  if (pathname === "/app") {
    const settings = new URLSearchParams(search).get("settings");
    if (settings === "confirmations") return "approvals";
    if (settings === "memory") return "memory";
  }
  return null;
}

/**
 * Which parts of the navigation show while an account's navigation is still growing. Without
 * `me.shortNav` (every existing account, older servers) everything shows and nothing is fetched.
 */
export function useMissions() {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const { pathname, search } = useLocation();
  // Reads what the screen beside the rail already loaded; the rail never takes the first bootstrap.
  const shortNav =
    useQuery({
      ...queries.bootstrap.queryOptions({ input: {} }),
      queryFn: skipToken,
      select: (bootstrap: AppBootstrap) => bootstrap.me?.shortNav === true,
    }).data === true;
  const key = queries.missions.get.queryKey();
  const { data } = useQuery({
    ...queries.missions.get.queryOptions(),
    enabled: shortNav,
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
  });
  const view: MissionsView | null = shortNav ? (data ?? null) : null;
  const ready = !shortNav || data !== undefined;
  const seen = useMutation(queries.missions.seen.mutationOptions());
  const showAllMutation = useMutation(queries.missions.showAll.mutationOptions());

  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (shortNav) void queryClient.invalidateQueries({ queryKey: key });
  }, [pathname, shortNav, queryClient, key]);

  const current = currentPart(pathname, search);
  const effective = shortNav ? (data === undefined ? LOADING : data) : null;
  const shows = useCallback(
    (part: NavPart) => partShows(part, effective, current),
    [effective, current],
  );
  const isNew = useCallback(
    (part: NavPart) => newParts(shortNav ? (data ?? null) : null).includes(part),
    [shortNav, data],
  );
  const open = useCallback(
    (part: NavPart) => {
      if (!isNew(part)) return;
      queryClient.setQueryData(key, (old: MissionsView | null | undefined) =>
        old ? { ...old, seen: [...old.seen, part] } : old,
      );
      seen.mutate(
        { part },
        { onError: () => void queryClient.invalidateQueries({ queryKey: key }) },
      );
    },
    [isNew, queryClient, key, seen],
  );
  const showAll = useCallback(() => {
    if (showAllMutation.isPending) return;
    showAllMutation.mutate(undefined, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: queries.bootstrap.queryKey({ input: {} }) });
      },
    });
  }, [showAllMutation, queryClient, key, queries]);

  return {
    view,
    ready,
    shows,
    isNew,
    open,
    showAll,
    showingAll: showAllMutation.isPending,
    listed: missionsVisible(view),
  };
}
