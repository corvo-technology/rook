import type { MissionsView } from "@corvo/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeActionButton } from "../components/native-action-button";
import { NativeSymbol } from "../components/native-symbol";
import { SettingsGroup, SettingsRow } from "../components/settings-group";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { missionRows } from "../lib/missions";
import { useSideInsets } from "../lib/side-insets";

/** The first missions of a new account, reached from the account screen while the list is on. */
export default function Missions() {
  const { t } = useI18n();
  const router = useRouter();
  const sideInsets = useSideInsets();
  const [view, setView] = useState<MissionsView | null>(null);
  const [pending, setPending] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void rpc("missions/get")
        .then((next) => {
          if (current) setView(next);
        })
        .catch(() => {});
      return () => {
        current = false;
      };
    }, []),
  );

  async function showEverything() {
    if (pending) return;
    setPending(true);
    try {
      await rpc("missions/showAll");
      await rpc("me").catch(() => undefined);
      router.back();
    } catch {
      // Nothing changed on the server, so the button stays and can be pressed again.
    } finally {
      setPending(false);
    }
  }

  const rows = missionRows(view, t);
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, sideInsets]}
      >
        <SettingsGroup>
          {rows.map((row) => (
            <SettingsRow
              key={row.id}
              title={row.title}
              accessibilityRole={row.href && !row.done ? "button" : undefined}
              accessibilityState={{ checked: row.done }}
              chevron={row.href && !row.done ? "right" : undefined}
              onPress={row.href && !row.done ? () => router.push(row.href as never) : undefined}
              trailing={row.done ? <NativeSymbol ios="checkmark" android="checkmark" /> : undefined}
            />
          ))}
        </SettingsGroup>
        {rows.length ? (
          <View style={styles.action}>
            <NativeActionButton
              disabled={pending}
              label={t("Show everything")}
              onPress={() => void showEverything()}
              prominence="secondary"
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16 },
  action: { alignItems: "center" },
});
