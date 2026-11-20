import type { ApprovalMode } from "@corvo/contracts";
import { storedBotApprovalMode } from "@corvo/core";
import { MenuView } from "@expo/ui/community/menu";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { autonomyOptions, confirmNeverAsk } from "../lib/autonomy";
import { useI18n } from "../lib/i18n";
import { useResolvedAppearance } from "../lib/native";

/**
 * Lets the person change when this agent asks from a waiting approval card. It approves nothing,
 * and the change can be undone until the card is answered.
 */
export function ChangeWhenToAsk({ botId, name }: { botId: string; name?: string }) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const colorScheme = useResolvedAppearance();
  const [level, setLevel] = useState<{
    own: ApprovalMode | null;
    fallback: ApprovalMode;
    checkerAvailable: boolean;
  } | null>(null);
  const [before, setBefore] = useState<{ own: ApprovalMode | null } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let current = true;
    void Promise.all([rpc("bots/get", { botId }), rpc("autoReview/get", {})])
      .then(([bot, review]) => {
        if (current)
          setLevel({
            own: bot.approvalMode ?? null,
            fallback: review.mode,
            checkerAvailable: review.checkerAvailable,
          });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [botId]);

  if (!level) return null;
  const value = level.own ?? level.fallback;

  async function save(own: ApprovalMode | null) {
    setPending(true);
    try {
      await rpc("bots/update", { botId, approvalMode: own });
      setLevel((current) => (current ? { ...current, own } : current));
      return true;
    } catch {
      return false;
    } finally {
      setPending(false);
    }
  }

  async function choose(choice: ApprovalMode) {
    if (pending || choice === value) return;
    if (choice === "never" && !(await confirmNeverAsk(t, name))) return;
    const previous = level?.own ?? null;
    if (await save(storedBotApprovalMode(choice, level?.fallback ?? "risky"))) {
      setBefore((current) => current ?? { own: previous });
    }
  }

  return (
    <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
      <MenuView
        actions={autonomyOptions(t, { value, checkerAvailable: level.checkerAvailable })}
        colorScheme={colorScheme}
        onPressAction={(event) => void choose(event.nativeEvent.event as ApprovalMode)}
        title={t("Change when to ask")}
      >
        <Text accessibilityRole="button" style={{ color: tokens.mutedForeground }}>
          {t("Change when to ask")}
        </Text>
      </MenuView>
      {before ? (
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={() => void save(before.own).then((saved) => saved && setBefore(null))}
        >
          <Text style={{ color: tokens.foreground }}>{t("Undo")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
