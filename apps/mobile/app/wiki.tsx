import type { WikiChange, WikiPageInfo } from "@corvo/contracts";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { NativeActionButton } from "../components/native-action-button";
import { WikiChangeCard, WikiList } from "../components/wiki-views";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens, useThemedStyles } from "../lib/native";
import { iosAtLeast } from "../lib/native-controls";
import { errorText } from "../lib/user-error";
import {
  approveAllWikiChanges,
  canApproveAll,
  decideWikiChange,
  groupWikiPages,
  listWikiChanges,
  listWikiPages,
} from "../lib/wiki";

/** What the team knows, as pages the agents read and cite. Read only on a phone. */
export default function WikiScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const tokens = useMobileTokens();
  const [pages, setPages] = useState<WikiPageInfo[] | null>(null);
  const [waiting, setWaiting] = useState<WikiChange[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupWikiPages(pages ?? []), [pages]);

  const load = useCallback(async () => {
    try {
      setPages(await listWikiPages());
      // What waits is a courtesy on top of the pages: not being able to read it hides it, no more.
      setWaiting(await listWikiChanges(["pending"]).catch(() => []));
      setError(null);
    } catch (cause) {
      setError(errorText(cause, t("Could not load pages")));
    }
  }, [t]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (title: string) => router.push({ pathname: "/wiki-page", params: { title } });
  async function decide(changeId: string, decision: "apply" | "refuse" | "undo") {
    if (deciding) return;
    setDeciding(changeId);
    try {
      await decideWikiChange(changeId, decision);
      await load();
    } catch {
      // Someone may have answered first: what is on screen is what the server says now.
      await load();
    } finally {
      setDeciding(null);
    }
  }

  async function approveAll() {
    if (deciding) return;
    setDeciding("all");
    try {
      const result = await approveAllWikiChanges();
      if (result.conflicts > 0) Alert.alert(t("A page changed since"));
    } catch {
      // Someone may have answered first: what is on screen is what the server says now.
    } finally {
      await load();
      setDeciding(null);
    }
  }

  const approveAllOffered = canApproveAll(waiting);
  const headerOptions = approveAllOffered
    ? {
        headerRight: () => (
          <NativeActionButton
            label={t("Approve all")}
            size="compact"
            disabled={deciding !== null}
            onPress={() => void approveAll()}
            style={{ borderRadius: 24 }}
          />
        ),
        ...(iosAtLeast(26)
          ? {
              unstable_headerRightItems: () => [
                {
                  type: "button" as const,
                  label: t("Approve all"),
                  variant: "prominent" as const,
                  tintColor: tokens.primary,
                  disabled: deciding !== null,
                  onPress: () => void approveAll(),
                },
              ],
            }
          : {}),
      }
    : {
        headerRight: () => null,
        ...(iosAtLeast(26) ? { unstable_headerRightItems: () => [] } : {}),
      };

  if (pages?.length || waiting.length)
    return (
      <>
        <Stack.Screen options={headerOptions} />
        <WikiList
          groups={groups}
          onOpen={open}
          header={waiting.map((change) => (
            <WikiChangeCard
              key={change.id}
              change={change}
              busy={deciding === change.id}
              onDecide={(decision) => void decide(change.id, decision)}
              onOpenPage={open}
            />
          ))}
        />
      </>
    );
  return (
    <View style={styles.empty}>
      {pages ? (
        <Text style={styles.message}>{t("No pages yet")}</Text>
      ) : error ? (
        <>
          <Text style={styles.message}>{error}</Text>
          <NativeActionButton
            label={t("Try Again")}
            variant="text"
            prominence="secondary"
            style={styles.retry}
            onPress={() => void load()}
          />
        </>
      ) : (
        <ActivityIndicator color={native.secondaryLabel} />
      )}
    </View>
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
    message: { color: native.secondaryLabel, fontSize: 17, textAlign: "center" },
    retry: { alignSelf: "center" },
  });
}
