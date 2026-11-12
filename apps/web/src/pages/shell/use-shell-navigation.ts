import type { Bot, Group } from "@corvo/contracts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { guardShellNavigate } from "../../lib/space-switch";
import { legacyOverlayTarget, searchString, shellOverlaySearch } from "../shell-overlay";

/** Router access for the shell: navigation stops once it unmounts, and old overlay links redirect. */
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
  /** Picking the thread for a bare or stale route keeps the plan choice the URL asked for. */
  const redirectKeepingOverlay = useCallback(
    (pathname: string) =>
      navigate(
        { pathname, search: shellOverlaySearch(searchParamsRef.current) },
        { replace: true },
      ),
    [navigate],
  );
  // Old `?settings=`, `?integrations` and `?mcp=` links land on their page, which remembers the way back.
  const legacy = legacyOverlayTarget(searchParams);
  const legacyTo = legacy?.to;
  useEffect(() => {
    if (!legacy) return;
    const from = `${window.location.pathname}${searchString(legacy.rest)}`;
    navigate(legacy.to, { replace: true, state: { from } });
  }, [legacyTo]);
  return {
    navigate,
    alive,
    searchParams,
    setSearchParams,
    searchParamsRef,
    redirectKeepingOverlay,
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
