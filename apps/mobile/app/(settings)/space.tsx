import type { SpaceSetting } from "@corvo/contracts";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadFailure } from "../../components/load-failure";
import { NativeSwitch } from "../../components/native-switch";
import { SettingsGroup, SettingsRow } from "../../components/settings-group";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import { settingsRpc, settingsTarget } from "../../lib/settings-target";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

/**
 * A Space follows the account's models, voice and approvals until one is customized for it.
 * Customizing opens the same screen the account uses, editing the Space's own copy.
 */
export default function SpaceSettings() {
  const { spaceId } = useLocalSearchParams<{ spaceId?: string }>();
  const target = useMemo(() => settingsTarget(spaceId), [spaceId]);
  const rpc = useMemo(() => settingsRpc(target), [target]);
  const router = useRouter();
  const { t } = useI18n();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const [overrides, setOverrides] = useState<SpaceSetting[] | null>(null);
  const [pause, setPause] = useState<{ canPause: boolean; paused: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (target.scope !== "space") return;
      let current = true;
      void rpc("spaceSettings/overrides")
        .then((next) => {
          if (!current) return;
          setOverrides(next);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          if (current) setLoadError(errorText(err, t("Something went wrong. Try again.")));
        });
      void rpc("spaces/list")
        .then((navigation) => {
          const found = navigation.spaces.find((item) => item.id === target.spaceId);
          if (current && found)
            setPause({ canPause: found.canPause === true, paused: !!found.pausedAt });
        })
        .catch(() => undefined);
      return () => {
        current = false;
      };
    }, [attempt, rpc, t, target.scope]),
  );

  if (target.scope !== "space") return null;
  const space = target.spaceId;
  // The "confirmations" setting opens the Approvals screen.
  const open = (setting: SpaceSetting) =>
    router.push({
      pathname: setting === "confirmations" ? "/approvals" : `/${setting}`,
      params: { spaceId: space },
    });

  async function customize(setting: SpaceSetting, enabled: boolean) {
    setPending(true);
    setError(null);
    setLoadError(null);
    try {
      setOverrides(await rpc("spaceSettings/setOverride", { setting, enabled }));
      if (enabled) open(setting);
    } catch (err) {
      setError(errorText(err, t("Could not save that preference")));
    } finally {
      setPending(false);
    }
  }

  async function setPaused(paused: boolean) {
    setPending(true);
    setError(null);
    try {
      const result = await rpc("spaces/setPaused", { spaceId: space, paused });
      setPause({ canPause: true, paused: !!result.pausedAt });
    } catch (err) {
      setError(errorText(err, t("Could not save that preference")));
    } finally {
      setPending(false);
    }
  }

  const row = (setting: SpaceSetting, title: string) => {
    const customized = overrides?.includes(setting) ?? false;
    return (
      <SettingsRow
        key={setting}
        accessibilityRole={customized ? "button" : undefined}
        title={title}
        chevron={customized ? "right" : undefined}
        onPress={customized ? () => open(setting) : undefined}
        trailing={
          <NativeSwitch
            accessibilityLabel={t("Customize {setting}", { setting: title })}
            value={customized}
            disabled={!overrides || pending}
            onValueChange={(next) => void customize(setting, next)}
          />
        }
      />
    );
  };

  const failure = error ?? loadError;
  const shownError = error ?? (overrides ? loadError : null);

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {failure && !overrides ? (
          <LoadFailure
            message={failure}
            onRetry={() => {
              setError(null);
              setLoadError(null);
              setAttempt((count) => count + 1);
            }}
          />
        ) : shownError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {shownError}
          </Text>
        ) : null}
        <SettingsGroup accessibilityLabel={t("Customize")} label={t("Customize")}>
          {row("models", t("Models"))}
          {row("voice", t("Voice"))}
          {row("confirmations", t("Approvals"))}
        </SettingsGroup>
        {pause?.canPause ? (
          <SettingsGroup>
            <SettingsRow
              title={t("Pause all bots")}
              trailing={
                <NativeSwitch
                  accessibilityLabel={t("Pause all bots")}
                  value={pause.paused}
                  disabled={pending}
                  onValueChange={(next) => {
                    if (!next) return void setPaused(false);
                    Alert.alert(
                      t("Pause all bots"),
                      t("Running work stops and nothing starts until you resume."),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Pause all bots"),
                          style: "destructive",
                          onPress: () => void setPaused(true),
                        },
                      ],
                    );
                  }}
                />
              }
            />
          </SettingsGroup>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    content: { width: "100%", padding: 20, gap: 24, paddingBottom: 40 },
    error: { color: tokens.destructive, fontSize: 14 },
  });
}
