import type { UserMemory } from "@corvo/contracts";
import { StyleSheet, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { NativeActionButton } from "./native-action-button";

export type MemoryFactCardProps = {
  memory: Pick<UserMemory, "text" | "state">;
  /** An answer is on its way, so the buttons wait. */
  busy?: boolean;
  onDecide: (decision: "save" | "discard" | "forget") => void;
};

/**
 * A fact an agent kept, or asks to keep, about the person. Nothing is stored as known before Save;
 * a fact an agent saved on its own can be undone here.
 */
export function MemoryFactCard({ memory, busy, onDecide }: MemoryFactCardProps) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const state = {
    pending: t("New memory"),
    saved: t("Remembered"),
    forgotten: t("Not remembered"),
  }[memory.state];
  return (
    <View style={styles.card} testID="memory-fact">
      <Text style={styles.state}>{state}</Text>
      <Text style={styles.text}>{memory.text}</Text>
      {memory.state === "pending" ? (
        <View style={styles.actions}>
          <NativeActionButton
            label={t("Save")}
            size="compact"
            fill={false}
            disabled={busy}
            onPress={() => onDecide("save")}
          />
          <NativeActionButton
            label={t("Discard")}
            size="compact"
            fill={false}
            variant="text"
            prominence="secondary"
            disabled={busy}
            onPress={() => onDecide("discard")}
          />
        </View>
      ) : null}
      {memory.state === "saved" ? (
        <View style={styles.actions}>
          <NativeActionButton
            label={t("Undo")}
            size="compact"
            fill={false}
            variant="text"
            prominence="secondary"
            disabled={busy}
            onPress={() => onDecide("forget")}
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    card: {
      gap: 8,
      marginHorizontal: 16,
      marginTop: 12,
      padding: 14,
      borderRadius: 14,
      backgroundColor: native.groupedCell,
    },
    state: { color: native.secondaryLabel, fontSize: 14 },
    text: { color: native.label, fontSize: 15 },
    actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  });
}
