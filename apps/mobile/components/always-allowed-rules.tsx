import type { ScopedApprovalRule } from "@corvo/contracts";
import { humanizeToolName } from "@corvo/core";
import { MenuView } from "@expo/ui/community/menu";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useResolvedAppearance } from "../lib/native";
import { SettingsGroup, SettingsRow } from "./settings-group";

/**
 * The always-allow rules kept from approval cards, each removable from its menu: one agent's on its
 * page, every agent's in settings. Nothing shows until a rule exists.
 */
export function AlwaysAllowedRules({ botId }: { botId?: string }) {
  const { t } = useI18n();
  const colorScheme = useResolvedAppearance();
  const [rules, setRules] = useState<ScopedApprovalRule[]>([]);
  const [pending, setPending] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void rpc("scopedApprovalRules/list", botId ? { botId } : {})
        .then((next) => {
          if (current) setRules(next);
        })
        .catch(() => undefined);
      return () => {
        current = false;
      };
    }, [botId]),
  );

  async function remove(rule: ScopedApprovalRule) {
    if (pending) return;
    setPending(true);
    try {
      await rpc("scopedApprovalRules/remove", { id: rule.id });
      setRules((current) => current.filter((entry) => entry.id !== rule.id));
    } catch {
      // The rule stays listed, so the person can try again.
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsGroup label={t("Always allowed")}>
      {rules.map((rule) => {
        const what = [humanizeToolName(rule.tool), rule.connection].filter(Boolean).join(" · ");
        const title = botId ? what : `${rule.botName} · ${what}`;
        return (
          <MenuView
            key={rule.id}
            actions={[{ id: "remove", title: t("Remove"), attributes: { destructive: true } }]}
            colorScheme={colorScheme}
            onPressAction={() => void remove(rule)}
            title={title}
          >
            <SettingsRow accessible accessibilityRole="button" dimmed={pending} title={title} />
          </MenuView>
        );
      })}
    </SettingsGroup>
  );
}
