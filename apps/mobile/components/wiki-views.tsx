import { ChatMarkdown } from "@corvo/chat-ui/native";
import type { WikiChange, WikiPage, WikiPageInfo } from "@corvo/contracts";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useResolvedAppearance, useThemedStyles } from "../lib/native";
import type { WikiGroup } from "../lib/wiki";
import { wikiDisplayBody } from "../lib/wiki";
import { NativeActionButton } from "./native-action-button";

type Row =
  | { type: "kind"; key: string; kind: string }
  | { type: "page"; key: string; page: WikiPageInfo };

/** The wiki's pages under their kind, each with the sentence that sums it up. */
export function WikiList({
  groups,
  onOpen,
  header,
}: {
  groups: WikiGroup[];
  onOpen: (title: string) => void;
  /** What waits for a person, shown above the pages. */
  header?: ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  const rows = useMemo<Row[]>(
    () =>
      groups.flatMap((group) => [
        { type: "kind" as const, key: `kind:${group.kind}`, kind: group.kind },
        ...group.pages.map((page) => ({
          type: "page" as const,
          key: `page:${page.title}`,
          page,
        })),
      ]),
    [groups],
  );
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={header ? <>{header}</> : undefined}
      contentInsetAdjustmentBehavior="automatic"
      renderItem={({ item }) =>
        item.type === "kind" ? (
          <Text style={styles.kind}>{item.kind}</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpen(item.page.title)}
            style={styles.row}
          >
            <Text style={styles.title} numberOfLines={1}>
              {item.page.title}
            </Text>
            {item.page.summary ? (
              <Text style={styles.summary} numberOfLines={1}>
                {item.page.summary}
              </Text>
            ) : null}
          </Pressable>
        )
      }
    />
  );
}

export type WikiChangeCardProps = {
  change: Pick<
    WikiChange,
    "state" | "reason" | "pages" | "edits" | "canSeeSource" | "sourceText" | "canRetry"
  >;
  /** An answer is on its way, so the buttons wait. */
  busy?: boolean;
  onDecide: (decision: "apply" | "refuse" | "undo") => void;
  onOpenPage: (title: string) => void;
  /** Asks for a change that hit a moved page to be written again. */
  onRetry?: () => void;
};

/**
 * What the wiki kept, or waits to keep, from a conversation: the pages, why, and the one thing a
 * person can do about it now. Approving and refusing are the phone's part; writing is not.
 */
export function WikiChangeCard({
  change,
  busy,
  onDecide,
  onOpenPage,
  onRetry,
}: WikiChangeCardProps) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const state = {
    pending: t("Waiting for approval"),
    applied: t("Added to the wiki"),
    refused: t("Refused"),
    undone: t("Undone"),
    conflict: t("A page changed since"),
  }[change.state];
  return (
    <View style={styles.change} testID="wiki-change">
      <Text style={styles.state}>{state}</Text>
      <View style={styles.pages}>
        {change.pages.map((page) => (
          <Pressable
            key={page.title}
            accessibilityRole="button"
            onPress={() => onOpenPage(page.title)}
          >
            <Text style={styles.pageName}>{page.title}</Text>
          </Pressable>
        ))}
      </View>
      {change.state === "pending"
        ? change.edits.map((edit, index) => (
            <View key={index} style={styles.edit}>
              <Text style={styles.editTitle}>
                {edit.section ? `${edit.title} · ${edit.section}` : edit.title}
              </Text>
              {edit.removed ? <Text style={styles.removed}>{edit.removed}</Text> : null}
              <Text style={styles.reason}>{edit.added}</Text>
            </View>
          ))
        : null}
      {change.reason ? <Text style={styles.reason}>{change.reason}</Text> : null}
      {change.state === "pending" ? (
        <View style={styles.actions}>
          <NativeActionButton
            label={t("Approve")}
            size="compact"
            fill={false}
            disabled={busy}
            onPress={() => onDecide("apply")}
          />
          <NativeActionButton
            label={t("Refuse")}
            size="compact"
            fill={false}
            variant="text"
            prominence="secondary"
            disabled={busy}
            onPress={() => onDecide("refuse")}
          />
        </View>
      ) : null}
      {change.state === "conflict" && change.canRetry && onRetry ? (
        <View style={styles.actions}>
          <NativeActionButton
            label={t("Try again")}
            size="compact"
            fill={false}
            variant="text"
            prominence="secondary"
            disabled={busy}
            onPress={onRetry}
          />
        </View>
      ) : null}
      {change.state === "applied" ? (
        <View style={styles.actions}>
          <NativeActionButton
            label={t("Undo")}
            size="compact"
            fill={false}
            variant="text"
            prominence="secondary"
            disabled={busy}
            onPress={() => onDecide("undo")}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A page's text, with its links to other pages followable and the pages that cite it. */
export function WikiPageView({
  page,
  pages,
  onOpen,
}: {
  page: WikiPage;
  pages: readonly WikiPageInfo[];
  onOpen: (title: string) => void;
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const colorScheme = useResolvedAppearance();
  const body = useMemo(() => wikiDisplayBody(page.body, pages), [page.body, pages]);
  const renderMention = (id: string, name?: ReactNode) => (
    <Text style={styles.link} accessibilityRole="link" onPress={() => onOpen(id)}>
      {name ?? id}
    </Text>
  );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.page}>
      <ChatMarkdown
        palette={mobileTokens()}
        colorScheme={colorScheme}
        renderMention={renderMention}
      >
        {body}
      </ChatMarkdown>
      {page.backlinks.length ? (
        <View accessibilityLabel={t("Cited by")} style={styles.citedBy}>
          {page.backlinks.map((title) => (
            <Pressable key={title} accessibilityRole="button" onPress={() => onOpen(title)}>
              <Text style={styles.cite}>{title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    kind: {
      color: native.secondaryLabel,
      fontSize: 13,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 6,
    },
    row: { paddingHorizontal: 20, paddingVertical: 10, gap: 2 },
    title: { color: native.label, fontSize: 17 },
    summary: { color: native.secondaryLabel, fontSize: 14 },
    page: { paddingHorizontal: 20, paddingVertical: 16, gap: 16 },
    link: { color: native.label, fontWeight: "600", textDecorationLine: "underline" },
    citedBy: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    cite: { color: native.secondaryLabel, fontSize: 14 },
    change: {
      gap: 8,
      marginHorizontal: 16,
      marginTop: 12,
      padding: 14,
      borderRadius: 14,
      backgroundColor: native.groupedCell,
    },
    state: { color: native.secondaryLabel, fontSize: 14 },
    pages: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    pageName: { color: native.label, fontSize: 16, fontWeight: "600" },
    reason: { color: native.label, fontSize: 15 },
    edit: { gap: 2, paddingVertical: 6 },
    editTitle: { color: native.secondaryLabel, fontSize: 12 },
    removed: { color: native.secondaryLabel, fontSize: 15, textDecorationLine: "line-through" },
    actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  });
}
