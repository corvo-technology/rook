import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** The route of a settings section: `/settings/approvals`. */
export function settingsPath(section: string): string {
  return `/settings/${section}`;
}

type SettingsLocationState = { from?: string } | null;

const DEFAULT_BACK = "/app";

/**
 * Opens a section's own route and remembers where the person was, so "← Settings" and Esc return
 * there. Use it for every entry point (menu items, "Add a model in Settings" links).
 */
export function useOpenSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (section: string) =>
      navigate(settingsPath(section), {
        state: { from: `${location.pathname}${location.search}` } satisfies SettingsLocationState,
      }),
    [navigate, location.pathname, location.search],
  );
}

/** Inside the settings page: switch sections without losing the way back, and go back. */
export function useSettingsNavigation() {
  const navigate = useNavigate();
  const state = useLocation().state as SettingsLocationState;
  const from = typeof state?.from === "string" && state.from.startsWith("/") ? state.from : null;
  return {
    select: (section: string) => navigate(settingsPath(section), { replace: true, state }),
    back: () => navigate(from ?? DEFAULT_BACK),
  };
}
