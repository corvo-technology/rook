import type { MessageVariants } from "@corvo/contracts";
import { Pressable, Text, View } from "react-native";
import { useI18n } from "../../lib/i18n";
import { useMobileTokens } from "../../lib/native";
import { NativeSymbol } from "../native-symbol";

/** "‹ 1 of 2 ›" under the message that opens one of several versions of the same point. */
export function VersionSwitcher({
  variants,
  disabled,
  onSwitch,
  alignEnd,
}: {
  variants: MessageVariants;
  disabled: boolean;
  onSwitch: (branchId: string | null) => void;
  alignEnd: boolean;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const step = (by: -1 | 1) => {
    const next = variants.branchIds[variants.index + by];
    if (next !== undefined) onSwitch(next);
  };
  const atStart = variants.index === 0;
  const atEnd = variants.index === variants.count - 1;
  const arrow = (direction: -1 | 1, off: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction < 0 ? t("Previous version") : t("Next version")}
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={10}
      onPress={() => step(direction)}
      style={{ opacity: off ? 0.35 : 1, padding: 4 }}
    >
      <NativeSymbol
        ios={direction < 0 ? "chevron.left" : "chevron.right"}
        android={direction < 0 ? "chevron-back" : "chevron-forward"}
        size={13}
        weight="semibold"
        color={tokens.mutedForeground}
      />
    </Pressable>
  );
  return (
    <View
      accessibilityLabel={t("{position} of {count}", {
        position: variants.index + 1,
        count: variants.count,
      })}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: alignEnd ? "flex-end" : "flex-start",
        marginTop: 2,
      }}
    >
      {arrow(-1, disabled || atStart)}
      <Text style={{ color: tokens.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] }}>
        {t("{position} of {count}", { position: variants.index + 1, count: variants.count })}
      </Text>
      {arrow(1, disabled || atEnd)}
    </View>
  );
}
