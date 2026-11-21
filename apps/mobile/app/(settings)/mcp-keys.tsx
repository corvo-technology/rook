import type { McpAccessKey, McpAccessLevel } from "@corvo/contracts";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from "react-native";
import {
  SettingsFooter,
  SettingsGroup,
  SettingsRow,
  useStackedSettings,
} from "../../components/settings-group";
import { formatActivityRelativeTime } from "../../lib/activity";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

/** The keys that let a desktop MCP client act as this person; made on the web, ended here. */
export default function McpKeys() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const stacked = useStackedSettings();
  const [keys, setKeys] = useState<McpAccessKey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const levelLabel: Record<McpAccessLevel, string> = {
    read: t("Read"),
    talk: t("Talk"),
    configure: t("Configure"),
  };

  const reload = useCallback(() => {
    setLoadFailed(false);
    void rpc("mcpAccess/list")
      .then((rows) => setKeys(rows.filter((key) => !key.revokedAt)))
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(reload, [reload]);

  function confirmRevoke(key: McpAccessKey) {
    Alert.alert(t("Revoke {name}?", { name: key.name }), undefined, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Revoke"),
        style: "destructive",
        onPress: () => {
          void rpc("mcpAccess/revoke", { keyId: key.id })
            .then(() => setKeys((current) => (current ?? []).filter((row) => row.id !== key.id)))
            .catch((cause: unknown) =>
              Alert.alert(t("MCP"), errorText(cause, t("Could not revoke the key"))),
            );
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={[styles.screen, sideInsets]}
      contentContainerStyle={[styles.container, stacked && styles.compactContainer]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {keys === null && !loadFailed ? <ActivityIndicator /> : null}
      {loadFailed ? (
        <SettingsGroup>
          <SettingsRow accessibilityRole="button" onPress={reload} title={t("Retry")} />
        </SettingsGroup>
      ) : null}
      {keys && keys.length > 0 ? (
        <SettingsGroup>
          {keys.map((key) => (
            <SettingsRow
              key={key.id}
              accessibilityRole="button"
              accessibilityLabel={t("Revoke {name}?", { name: key.name })}
              title={key.name}
              detail={[
                levelLabel[key.level],
                key.spaceName,
                key.lastUsedAt ? formatActivityRelativeTime(key.lastUsedAt) : t("Never used"),
              ]
                .filter(Boolean)
                .join(" · ")}
              onPress={() => confirmRevoke(key)}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {keys && keys.length === 0 ? (
        <SettingsFooter>{t("Keys are made in Rook on the web.")}</SettingsFooter>
      ) : null}
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    container: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 28 },
    compactContainer: { paddingHorizontal: 8 },
  });
}
