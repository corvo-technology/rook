import type { VaultCredential } from "@corvo/contracts";
import { commandVariableName } from "@corvo/contracts";
import { MenuView } from "@expo/ui/community/menu";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadFailure } from "../../components/load-failure";
import { SettingsGroup, SettingsRow } from "../../components/settings-group";
import { rpc } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { native, useResolvedAppearance, useThemedStyles } from "../../lib/native";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

/** Where a credential goes: its site, or the shell variable a command credential is exported as. */
function destinationLabel(credential: VaultCredential): string {
  return credential.auth?.type === "command"
    ? `$${commandVariableName(credential.name)}`
    : credential.origin;
}

/**
 * The credentials the person can see in this space, with the one thing a phone is good for:
 * taking one away. Adding, replacing and choosing agents happen on the web, where a value can be
 * pasted; the thread card still saves one on the phone.
 */
export default function Vault() {
  const { t } = useI18n();
  const colorScheme = useResolvedAppearance();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const [credentials, setCredentials] = useState<VaultCredential[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Counts removals, so a read that started before one never shows what it replaced.
  const removals = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      const removalsAtRead = removals.current;
      void rpc("vault/list")
        .then((next) => {
          if (!current || removals.current !== removalsAtRead) return;
          setCredentials(next);
          setLoadError(null);
        })
        .catch((cause: unknown) => {
          if (current) setLoadError(errorText(cause, t("Something went wrong. Try again.")));
        });
      return () => {
        current = false;
      };
    }, [attempt, t]),
  );

  async function remove(credential: VaultCredential) {
    if (pending) return;
    removals.current += 1;
    setPending(true);
    setError(null);
    try {
      await rpc("vault/remove", { id: credential.id });
      setCredentials((current) => current?.filter((entry) => entry.id !== credential.id) ?? null);
    } catch (cause) {
      setError(errorText(cause, t("Something went wrong. Try again.")));
    } finally {
      setPending(false);
    }
  }

  const failure = error ?? loadError;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {failure && !credentials ? (
          <LoadFailure
            message={failure}
            onRetry={() => {
              setError(null);
              setLoadError(null);
              setAttempt((count) => count + 1);
            }}
          />
        ) : failure ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {failure}
          </Text>
        ) : null}
        {credentials?.length ? (
          <SettingsGroup>
            {credentials.map((credential) =>
              credential.canManage ? (
                <MenuView
                  key={credential.id}
                  actions={[
                    { id: "remove", title: t("Remove"), attributes: { destructive: true } },
                  ]}
                  colorScheme={colorScheme}
                  onPressAction={() => void remove(credential)}
                  title={credential.name}
                >
                  <SettingsRow
                    accessible
                    accessibilityRole="button"
                    dimmed={pending}
                    title={credential.name}
                    value={destinationLabel(credential)}
                  />
                </MenuView>
              ) : (
                <SettingsRow
                  key={credential.id}
                  title={credential.name}
                  value={destinationLabel(credential)}
                />
              ),
            )}
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
