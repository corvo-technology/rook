import {
  buildComposerMentionOptions,
  foldPeerReplies,
  foldThreadReplies,
  liveActivityLine,
  liveMessageComposing,
  newClientId,
  resolveComposerSendPlan,
} from "@corvo/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobileMessage, MobileSnapshot } from "../../lib/api";
import { mergeMobileSnapshot, rpc } from "../../lib/api";
import { useAppForeground } from "../../lib/app-foreground";
import { mobileTokens } from "../../lib/appearance";
import { cronLabels } from "../../lib/cron";
import { useI18n } from "../../lib/i18n";
import { useKeyboardLayout } from "../../lib/keyboard-layout";
import { useThemedStyles } from "../../lib/native";
import { currentSessionGeneration } from "../../lib/session";
import { useThreadSnapshot } from "../../lib/thread-history";
import { threadKeyboardOffset } from "../../lib/thread-keyboard-offset";
import { useThreadLiveSubscription } from "../../lib/thread-live";
import { useThreadTranscript } from "../../lib/thread-transcript";
import { useSpeakMessages } from "../../lib/thread-voice";
import { errorText } from "../../lib/user-error";
import { SelectTextSheet } from "../select-text-sheet";
import type { ThreadComposerHandle } from "../thread-composer";
import { ThreadComposer } from "../thread-composer";
import { ThreadFetchErrorNotice } from "../thread-error-notice";
import { createThreadHeaderStyles } from "../thread-header-styles";
import { ThreadComposerDock } from "./thread-composer-dock";
import { ThreadWorkingFooter } from "./thread-list-controls";
import { useLatestRowActions, useThreadRows } from "./thread-rows";

const NO_MENTION_BOTS: never[] = [];
const noop = () => undefined;

/**
 * One channel message and the replies under it, with a composer that answers into the thread.
 * The channel's own snapshot and live stream feed it, so it opens already current.
 */
export function ChannelThread({ sessionEpoch, userId }: { sessionEpoch: number; userId: string }) {
  const { groupId = "", rootId = "" } = useLocalSearchParams<{
    groupId?: string;
    rootId?: string;
  }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const tokens = mobileTokens();
  const styles = useThemedStyles(createThreadHeaderStyles);
  const insets = useSafeAreaInsets();
  const foreground = useAppForeground();
  const keyboardLayout = useKeyboardLayout();
  const headerHeight = useHeaderHeight();
  const history = useThreadSnapshot();
  const { snap, commitSnap, snapRef } = history;
  const [error, setError] = useState<string | null>(null);
  // The root can sit before the page the snapshot holds; it is read on its own then.
  const [rootPage, setRootPage] = useState<MobileMessage[]>([]);
  const [selectableText, setSelectableText] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<ThreadComposerHandle>(null);
  // One nonce per draft, so a retry after a dropped connection never posts it twice.
  const draftNonce = useRef<{ draft: string; nonce: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  async function refresh() {
    const generation = currentSessionGeneration();
    const next = await rpc("threads/get", { groupId });
    if (generation !== currentSessionGeneration()) return undefined;
    commitSnap(mergeMobileSnapshot(snapRef.current, next));
    return snapRef.current ?? undefined;
  }

  const unreadTarget = useRef<string | null>(null);
  useThreadLiveSubscription({
    groupId,
    foreground,
    readOnly: false,
    sessionEpoch,
    historyEpoch: history.historyEpoch,
    expandedHistoryThread: history.expandedHistoryThread,
    pinnedAroundRef: history.pinnedAroundRef,
    jumpScrollTarget: history.jumpScrollTarget,
    jumpAnchor: history.jumpAnchor,
    snapRef,
    readVisibleTarget: unreadTarget,
    showSavedThread: noop,
    refresh: async () => refresh(),
    commitSnap,
    setError,
    refreshMentionBots: async () => undefined,
    markReadIfVisible: noop,
  });

  const loaded = snap?.messages;
  const rootLoaded = loaded?.some((message) => message.id === rootId) ?? false;
  useEffect(() => {
    if (!loaded || rootLoaded || !rootId) return;
    let cancelled = false;
    void rpc("threads/messages", { groupId, around: { messageId: rootId } })
      .then((page) => {
        if (!cancelled) setRootPage(page.messages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [groupId, loaded === undefined, rootLoaded, rootId]);

  const messages = useMemo(() => {
    if (!loaded) return undefined;
    if (rootLoaded) return loaded;
    const known = new Set(loaded.map((message) => message.id));
    return [...rootPage.filter((message) => !known.has(message.id)), ...loaded].sort(
      (a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER),
    );
  }, [loaded, rootLoaded, rootPage]);
  const root = messages?.find((message) => message.id === rootId);
  const replies = useMemo(
    () =>
      foldThreadReplies(foldPeerReplies(messages ?? [], { includePeerReceipts: true })).folded.get(
        rootId,
      ) ?? [],
    [messages, rootId],
  );
  const threadMessages = useMemo(() => (root ? [root, ...replies] : []), [root, replies]);
  const threadSnap = useMemo<MobileSnapshot | null>(
    () => (snap ? { ...snap, messages: threadMessages } : null),
    [snap, threadMessages],
  );
  const transcript = useThreadTranscript(threadMessages, true, false);
  const visibleMessages = transcript.reactionView.visibleMessages;

  const speak = useSpeakMessages({
    visibleMessages,
    members: snap?.members,
    mentionBots: NO_MENTION_BOTS,
  });
  const rowActions = useLatestRowActions({
    helperToggle: (_measure, toggle) => toggle(),
    reply: noop,
    quote: noop,
    select: setSelectableText,
    speak,
    react: async () => false,
    markUnread: noop,
    keepInWiki: noop,
    answer: async () => undefined,
    openBot: (id, name) => router.push({ pathname: "/thread", params: { botId: id, name } }),
    openComputer: (id, name) => router.push({ pathname: "/computer", params: { botId: id, name } }),
    previewMarkdown: noop,
    previewImage: (target) => router.push({ pathname: "/image", params: { ...target, groupId } }),
    jump: noop,
    dismissChoice: transcript.dismissChoice,
    openPeerChat: noop,
    togglePeerReplies: transcript.togglePeerReplies,
    layout: noop,
  });
  const { renderMessageRow } = useThreadRows({
    snap: threadSnap,
    userId,
    transcript,
    rowActions,
    groupId,
    inGroup: true,
    // Reacting, quoting and unread belong to the channel; here the person reads and replies.
    readOnly: true,
    onCall: false,
    mentionBots: NO_MENTION_BOTS,
    columnWidth: 0,
    readSeq: null,
    highlightedMessageId: null,
  });

  const workingBots = useMemo(() => {
    const seen = new Set<string>();
    return replies.flatMap((reply) => {
      if (!reply.id.startsWith("progress:") || !reply.botId || seen.has(reply.botId)) return [];
      seen.add(reply.botId);
      const member = snap?.members?.find((candidate) => candidate.botId === reply.botId);
      return [
        {
          id: reply.botId,
          name: member?.name,
          color: member?.color ?? "",
          status: "running",
          composing: liveMessageComposing(reply.blocks),
        },
      ];
    });
  }, [replies, snap?.members]);

  const mentionTargets = useMemo(
    () =>
      buildComposerMentionOptions({
        query: "",
        includeEveryone: true,
        currentGroupId: groupId,
        bots: (snap?.members ?? []).map((member) => ({
          id: member.botId,
          name: member.name,
          color: member.color,
        })),
        groups: [],
        routines: [],
        connectors: [],
        cronLabels: cronLabels(locale),
      }),
    [groupId, locale, snap?.members],
  );

  // New replies bring the end of the thread into view.
  const lastReplyId = replies.at(-1)?.id;
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [lastReplyId, workingBots.length]);

  async function send() {
    const submitted = composerRef.current?.snapshot();
    if (!submitted || sending || !rootId) return;
    const plan = resolveComposerSendPlan({
      text: submitted.promptText,
      mentions: submitted.mentions,
      hasAttachments: false,
    });
    if (!plan.shouldSend) return;
    const draft = JSON.stringify(submitted);
    const nonce = draftNonce.current?.draft === draft ? draftNonce.current.nonce : newClientId();
    draftNonce.current = { draft, nonce };
    setSending(true);
    try {
      await rpc("threads/send", {
        groupId,
        threadRootId: rootId,
        text: plan.trimmed,
        mentions: plan.mentionPayload.length ? plan.mentionPayload : undefined,
        clientNonce: nonce,
      });
      draftNonce.current = null;
      composerRef.current?.reset();
      await refresh().catch(() => undefined);
    } catch (cause) {
      Alert.alert(t("Failed to send message"), errorText(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <View ref={keyboardLayout.container} onLayout={keyboardLayout.onLayout} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={threadKeyboardOffset({
          os: Platform.OS,
          floatingHeader: false,
          nativeHeaderHeight: headerHeight,
          measuredOffset: keyboardLayout.offset,
        })}
        style={{
          flex: 1,
          backgroundColor: tokens.background,
          paddingLeft: 20 + insets.left,
          paddingRight: 20 + insets.right,
        }}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {root ? null : (
            <ActivityIndicator color={tokens.mutedForeground} style={{ margin: 24 }} />
          )}
          {threadMessages.map((message, index) => renderMessageRow(message, { index }))}
          <ThreadWorkingFooter
            bots={workingBots}
            atBottom
            label={liveActivityLine(replies) ?? t("Working…")}
          />
        </ScrollView>
        <ThreadFetchErrorNotice error={error} showingSaved={false} />
        <ThreadComposerDock
          hidden={!root}
          fadeStyle={styles.composerFade}
          replyTarget={null}
          replyAuthor=""
          replyQuote={null}
          onDismissReply={noop}
          attachmentNotice={null}
          attachments={[]}
          onRemoveAttachment={noop}
        >
          <ThreadComposer
            onFocus={keyboardLayout.onFocus}
            key={rootId}
            ref={composerRef}
            agentSkills={[]}
            composerMentionTargets={mentionTargets}
            composerPrompt={t("Reply in thread")}
            replyQuote={null}
            attachmentIds={[]}
            onCall={false}
            working={false}
            sending={sending}
            styles={styles}
            attachActions={[]}
            attachFrom={noop}
            send={send}
            stop={async () => undefined}
            startVoiceCall={async () => undefined}
            onSlashAction={noop}
          />
        </ThreadComposerDock>
        {selectableText !== null ? (
          <SelectTextSheet text={selectableText} onClose={() => setSelectableText(null)} />
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}
