import type { ThreadSummary } from "@corvo/core";
import { typeScale } from "@corvo/ui-tokens";
import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { dateLocaleForUi, useI18n } from "../lib/i18n";
import { BotAvatar } from "./bot-avatar";
import { NativeSymbol } from "./native-symbol";

export type ThreadFooterData = {
  summary: ThreadSummary;
  faces: readonly { botId: string; color: string }[];
};

/** What a channel message with replies shows beneath it: who replied, how many and when last. */
export function ThreadFooter({ thread, onOpen }: { thread: ThreadFooterData; onOpen: () => void }) {
  const tokens = mobileTokens();
  const { t, locale } = useI18n();
  const { summary, faces } = thread;
  const count = summary.count === 1 ? t("1 reply") : t("{count} replies", { count: summary.count });
  const last = new Date(summary.lastAt).toLocaleTimeString(dateLocaleForUi(locale), {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count}, ${last}`}
      onPress={onOpen}
      hitSlop={{ top: 6, bottom: 6 }}
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 4,
        paddingVertical: 4,
      }}
    >
      <View style={{ flexDirection: "row" }}>
        {faces.map((face, index) => (
          <View key={face.botId} style={{ marginStart: index === 0 ? 0 : -4 }}>
            <BotAvatar color={face.color} size={18} />
          </View>
        ))}
      </View>
      <Text style={{ color: tokens.foreground, ...typeScale.caption, fontWeight: "600" }}>
        {count}
      </Text>
      <Text style={{ color: tokens.mutedForeground, ...typeScale.caption }}>{last}</Text>
      <NativeSymbol
        ios="chevron.right"
        android="chevron-forward"
        size={12}
        color={tokens.mutedForeground}
      />
    </Pressable>
  );
}
