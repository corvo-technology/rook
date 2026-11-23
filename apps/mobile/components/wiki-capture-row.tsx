import type { WikiCaptureState } from "@corvo/contracts";
import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { getWikiCapture, setWikiCapture } from "../lib/wiki";
import { MenuPicker } from "./menu-picker";
import { SettingsGroup } from "./settings-group";

type Choice = "default" | "on" | "off";
const toValue = (choice: string): boolean | null =>
  choice === "on" ? true : choice === "off" ? false : null;
const toChoice = (capture: boolean | null): Choice =>
  capture === null ? "default" : capture ? "on" : "off";

/** Whether the wiki curator reads one conversation; nothing while it cannot or may not change. */
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
  if (!state?.available || !state.canChange) return null;

  function change(choice: string) {
    const before = state;
    const capture = toValue(choice);
    setState((now) => (now ? { ...now, capture } : now));
    setWikiCapture({ botId, groupId }, capture).catch(() => setState(before));
  }

  return (
    <SettingsGroup>
      <MenuPicker
        label={t("Learn from this conversation")}
        choices={[
          { key: "default", label: t("Default") },
          { key: "on", label: t("Always") },
          { key: "off", label: t("Never") },
        ]}
        value={toChoice(state.capture)}
        onChange={change}
      />
    </SettingsGroup>
  );
}
