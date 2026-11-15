import type { SearchHit } from "@corvo/contracts";
import { useEffect, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";
import type { useShellNavigation } from "./use-shell-navigation";

/** The sidebar's search box: it filters the roster and searches the space. */
export function useSidebarSearch({
  rpc,
  navigate,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  navigate: ReturnType<typeof useShellNavigation>["navigate"];
}) {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const spaceQuery = query.trim();
  const showSpaceSearch = spaceQuery.length > 0;

  useEffect(() => {
    if (!showSpaceSearch) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void rpc.search
        .query({ q: spaceQuery })
        .then((result) => {
          if (!abort.signal.aborted) setSearchHits(result.hits);
        })
        .catch(() => {
          if (!abort.signal.aborted) setSearchHits([]);
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearchLoading(false);
        });
    }, 200);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [showSpaceSearch, spaceQuery]);

  function jumpToSearchHit(hit: SearchHit) {
    setQuery("");
    setSearchOpen(false);
    setSearchHits([]);
    const params = new URLSearchParams();
    if (hit.messageId) params.set("m", hit.messageId);
    if (hit.routineId) params.set("routine", hit.routineId);
    navigate({
      pathname: hit.groupId ? `/app/g/${hit.groupId}` : `/app/${hit.botId}`,
      search: params.toString() ? `?${params.toString()}` : undefined,
    });
  }

  return {
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    searchHits,
    searchLoading,
    showSpaceSearch,
    jumpToSearchHit,
  };
}

export type SidebarSearch = ReturnType<typeof useSidebarSearch>;
