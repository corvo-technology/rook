import type { Bot, Group } from "@corvo/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { settingsPath } from "../../lib/settings-route";
import { guardShellNavigate } from "../../lib/space-switch";
import type { ShellOverlay } from "../shell-overlay";
import {
  readShellOverlay,
  searchString,
  shellOverlaySearch,
  withShellOverlay,
} from "../shell-overlay";

/** Router access for the shell: navigation stops once it unmounts, and overlays live in the URL. */
export function useShellNavigation() {
  const routerNavigate = useNavigate();
  const navigateRef = useRef(routerNavigate);
  navigateRef.current = routerNavigate;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const navigate = useMemo(
    () =>
      guardShellNavigate(
        () => navigateRef.current,
        () => alive.current,
      ),
    [],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  // Mirrors searchParams for effects that only need to read it once on run,
  // not re-run on every unrelated query-param change (e.g. the SSE subscribe
  // effect, which should only restart when the active bot changes).
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  /** Picking the thread for a bare or stale route keeps an overlay the URL asked for. */
  const redirectKeepingOverlay = useCallback(
    (pathname: string) =>
      navigate(
        { pathname, search: shellOverlaySearch(searchParamsRef.current) },
        { replace: true },
      ),
    [navigate],
  );
  const overlay = readShellOverlay(searchParams);
  // Settings sections that have their own page leave the shell: the page remembers where to return.
  function openSettingsPage(section: string, replace: boolean) {
    // Coming from another settings section returns there; a stale link to this one returns to the page.
    const rest = goesToPage ? withShellOverlay(searchParams, null) : searchParams;
    const from = `${window.location.pathname}${searchString(rest)}`;
    navigate(settingsPath(section), { replace, state: { from } });
  }
  const goesToPage = overlay?.kind === "settings" && overlay.section === "confirmations";
  // A link or reload that still carries ?settings=confirmations lands on the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the overlay decides this
  useEffect(() => {
    if (goesToPage) openSettingsPage("approvals", true);
  }, [goesToPage]);
  // Overlays replace the URL rather than adding history, so opening and closing never race a navigation.
  function setOverlay(next: ShellOverlay) {
    if (next?.kind === "settings" && next.section === "confirmations") {
      openSettingsPage("approvals", false);
      return;
    }
    navigate({ search: searchString(withShellOverlay(searchParams, next)) }, { replace: true });
  }
  return {
    navigate,
    alive,
    searchParams,
    setSearchParams,
    searchParamsRef,
    redirectKeepingOverlay,
    overlay,
    setOverlay,
  };
}

export function firstThreadRoute(
  bots: readonly Pick<Bot, "id">[],
  groups: readonly Pick<Group, "id">[],
): string {
  if (bots[0]) return `/app/${bots[0].id}`;
  if (groups[0]) return `/app/g/${groups[0].id}`;
  return "/app";
}
