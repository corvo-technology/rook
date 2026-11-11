import type { WikiCaptureState } from "@corvo/contracts";
import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { getWikiCapture, setWikiCapture } from "../lib/wiki";
import { SettingsGroup, SettingsSwitch } from "./settings-group";

/** Whether the wiki curator reads one conversation; nothing while it cannot. */
export function WikiCaptureRow({ target }: { target: { botId?: string; groupId?: string } }) {
  const { t } = useI18n();
  const [state, setState] = useState<WikiCaptureState | null>(null);
  const { botId, groupId } = target;
  useEffect(() => {
    let current = true;
    getWikiCapture({ botId, groupId })
      .then((next) => current && setState(next))
      .catch(() => current && setState(null));
    return () => {
      current = false;
    };
  }, [botId, groupId]);
  if (!state?.available) return null;

  function change(next: boolean) {
    const before = state;
    setState((now) => (now ? { ...now, capture: next, on: next } : now));
    setWikiCapture({ botId, groupId }, next).catch(() => setState(before));
  }

  return (
    <SettingsGroup>
      <SettingsSwitch
        label={t("Learn from this conversation")}
        value={state.on}
        disabled={!state.canChange}
        onChange={change}
      />
    </SettingsGroup>
  );
}
