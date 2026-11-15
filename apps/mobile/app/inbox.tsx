import type { NotificationList } from "@corvo/contracts";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { NativeActionButton } from "../components/native-action-button";
import { formatActivityRelativeTime } from "../lib/activity";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useForegroundPoll } from "../lib/foreground-poll";
import { useI18n } from "../lib/i18n";
import type { InboxEntry } from "../lib/inbox-notifications";
import { groupInbox, inboxKindCue, inboxMarkRead, inboxRoute } from "../lib/inbox-notifications";
import { native, useThemedStyles } from "../lib/native";
import { iosAtLeast } from "../lib/native-controls";
import { INBOX_POLL_INTERVAL_MS } from "../lib/poll-cadence";
import { useSideInsets } from "../lib/side-insets";

/** What names the member across the space: mentions, replies, approvals and alerts. */
export default function InboxScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const sideInsets = useSideInsets();
  const tokens = mobileTokens();
  const [list, setList] = useState<NotificationList | null>(null);
  const [focused, setFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await rpc("inbox/list"));
    } catch {
      // The last list stays; the next refresh tries again.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useForegroundPoll(load, INBOX_POLL_INTERVAL_MS, focused);

  const markAllRead = useCallback(async () => {
    try {
      await rpc("inbox/markAllRead");
    } catch {
      // Nothing changed on the server; the reload below shows what is still unread.
    }
    await load();
  }, [load]);

  const open = useCallback(
    async (entry: InboxEntry) => {
      const mark = inboxMarkRead(entry);
      const route = inboxRoute(entry.latest);
      if (route) router.push(route as never);
      if (!mark) return;
      try {
        await rpc("inbox/markRead", mark);
      } catch {
        // Marked on the next open; the row simply stays unread for now.
      }
      await load();
    },
    [load, router],
  );

  const entries = list ? groupInbox(list.items) : [];
  const headerOptions =
    list && list.unreadCount > 0
      ? {
          headerRight: () => (
            <NativeActionButton
              label={t("Mark all read")}
              size="compact"
              onPress={() => void markAllRead()}
              style={{ borderRadius: 24 }}
            />
          ),
          ...(iosAtLeast(26)
            ? {
                unstable_headerRightItems: () => [
                  {
                    type: "button" as const,
                    label: t("Mark all read"),
                    variant: "prominent" as const,
                    tintColor: tokens.primary,
                    onPress: () => void markAllRead(),
                  },
                ],
              }
            : {}),
        }
      : {
          headerRight: () => null,
          ...(iosAtLeast(26) ? { unstable_headerRightItems: () => [] } : {}),
        };

  return (
    <>
      <Stack.Screen options={headerOptions} />
      <FlatList<InboxEntry>
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={sideInsets}
        data={entries}
        keyExtractor={(entry) => entry.key}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
        ListEmptyComponent={
          list ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t("Nothing here")}</Text>
            </View>
          ) : null
        }
        renderItem={({ item: entry }) => {
          const { latest } = entry;
          const cue = inboxKindCue(latest.kind, t);
          const by = latest.actor ? `${latest.actor.name} · ${cue}` : cue;
          const preview = latest.preview ?? latest.detail ?? "";
          const time = formatActivityRelativeTime(latest.createdAt);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={[
                latest.source,
                entry.unread ? t("unread") : null,
                by,
                preview,
                time,
              ]
                .filter(Boolean)
                .join(", ")}
              onPress={() => void open(entry)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.dotSlot}>
                {entry.unread ? <View accessibilityElementsHidden style={styles.dot} /> : null}
              </View>
              <View style={styles.body}>
                <View style={styles.top}>
                  <Text style={styles.source} numberOfLines={1}>
                    {latest.source}
                  </Text>
                  <Text style={styles.time}>{time}</Text>
                </View>
                <Text style={styles.by} numberOfLines={1}>
                  {by}
                </Text>
                {preview ? (
                  <Text
                    style={[styles.preview, entry.unread && styles.unreadPreview]}
                    numberOfLines={2}
                  >
                    {preview}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: native.page },
    row: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 16, gap: 8 },
    rowPressed: { backgroundColor: native.fillPressed },
    dotSlot: { width: 10, paddingTop: 7 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.unread },
    body: { flex: 1, gap: 2 },
    top: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    source: { flex: 1, fontSize: 17, fontWeight: "600", color: native.label },
    time: { fontSize: 13, color: native.secondaryLabel },
    by: { fontSize: 13, color: native.secondaryLabel },
    preview: { fontSize: 15, color: native.secondaryLabel },
    unreadPreview: { color: native.label },
    empty: { alignItems: "center", paddingTop: 64 },
    emptyText: { fontSize: 17, color: native.secondaryLabel },
  });
}
