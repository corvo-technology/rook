import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/** The query parameter that holds the open panel, e.g. `?panel=new-routine` or `?panel=bot:abc`. */
export const SIDE_PANEL_PARAM = "panel";

/** `"bot:abc"` is `{ kind: "bot", id: "abc" }`; `"new-routine"` has no id. */
export function parseSidePanel(panel: string | null): { kind: string; id: string | null } | null {
  if (!panel) return null;
  const split = panel.indexOf(":");
  if (split < 0) return { kind: panel, id: null };
  return { kind: panel.slice(0, split), id: panel.slice(split + 1) || null };
}

export function sidePanelValue(kind: string, id?: string | null): string {
  return id ? `${kind}:${id}` : kind;
}

/**
 * The panel the URL asks for. There is only one `?panel=` value, so opening another panel replaces
 * the current one; a reload or shared link opens the same panel. Render `<SidePanel open={...}>`
 * from `panel`, and call `open`/`close` instead of keeping panel state in a component.
 */
export function useSidePanel() {
  const [params, setParams] = useSearchParams();
  const panel = params.get(SIDE_PANEL_PARAM);
  const open = useCallback(
    (value: string) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(SIDE_PANEL_PARAM, value);
        return next;
      }),
    [setParams],
  );
  const close = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(SIDE_PANEL_PARAM);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return {
    panel,
    parsed: parseSidePanel(panel),
    isOpen: (value: string) => panel === value,
    open,
    close,
  };
}
