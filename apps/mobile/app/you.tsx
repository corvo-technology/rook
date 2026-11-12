import type { UserMemory } from "@corvo/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { NativeActionButton } from "../components/native-action-button";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { decideYouMemory, listYouMemories } from "../lib/you-memory";

/**
 * What the person's agents know about them. A phone saves or discards what an agent suggests and
 * reads the rest; teaching, editing and forgetting are done on the web and desktop apps.
 */
export default function YouScreen() {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const [memories, setMemories] = useState<UserMemory[] | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemories(await listYouMemories(["pending", "saved"]));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function decide(memoryId: string, decision: "save" | "discard") {
    if (deciding) return;
    setDeciding(memoryId);
    try {
      await decideYouMemory(memoryId, decision);
    } catch {
      // Someone may have answered first: what is on screen is what the server says now.
    } finally {
      await load();
      setDeciding(null);
    }
  }

  if (!memories)
    return (
      <View style={styles.empty}>
        {failed ? (
          <NativeActionButton
            label={t("Try Again")}
            variant="text"
            prominence="secondary"
            onPress={() => void load()}
          />
        ) : (
          <ActivityIndicator color={native.secondaryLabel} />
        )}
      </View>
    );
  return (
    <FlatList
      data={memories}
      keyExtractor={(memory) => memory.id}
      contentInsetAdjustmentBehavior="automatic"
      renderItem={({ item }) => (
        <View style={styles.row} testID="you-memory">
          <Text style={styles.text}>{item.text}</Text>
          {item.state === "pending" ? (
            <View style={styles.actions}>
              <NativeActionButton
                label={t("Save")}
                size="compact"
                fill={false}
                disabled={deciding !== null}
                onPress={() => void decide(item.id, "save")}
              />
              <NativeActionButton
                label={t("Discard")}
                size="compact"
                fill={false}
                variant="text"
                prominence="secondary"
                disabled={deciding !== null}
                onPress={() => void decide(item.id, "discard")}
              />
            </View>
          ) : null}
        </View>
      )}
    />
  );
}

function createStyles() {
  return StyleSheet.create({
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 32,
      gap: 8,
      backgroundColor: native.groupedPage,
    },
    row: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
    text: { color: native.label, fontSize: 17 },
    actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  });
}
