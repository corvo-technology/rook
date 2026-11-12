import {
  expandPeerReplies,
  foldPeerReplies,
  foldThreadReplies,
  projectBotMentions,
  projectMessageReactions,
  shouldShowBotSenderName,
} from "@corvo/core";
import { useMemo, useState } from "react";
import type { MobileMessage } from "./api";
import { applyLocalChoiceDismissals, hasVisibleMessagePresentation } from "./message-presentation";

/**
 * What the chat draws from its messages: peer replies folded under their marker until expanded,
 * mentions and reactions folded into the message they belong to, and choices the user dismissed
 * here hidden.
 */
export function useThreadTranscript(
  messages: MobileMessage[] | undefined,
  inGroup: boolean,
  /** A channel's replies live in their threads; a thread itself shows them in a row. */
  foldThreads = inGroup,
) {
  const [dismissedChoiceQuestions, setDismissedChoiceQuestions] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const [expandedPeerMarkers, setExpandedPeerMarkers] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const showBotSenderName = useMemo(
    () =>
      shouldShowBotSenderName({
        isGroup: inGroup,
        speakerBotIds: (messages ?? [])
          .filter((message) => message.role === "bot")
          .map((message) => message.botId),
      }),
    [inGroup, messages],
  );
  const peerTranscript = useMemo(() => {
    const peerFolded = foldPeerReplies(messages ?? [], { includePeerReceipts: true });
    // In a channel each message's replies are read in its thread, not in the main column.
    return foldThreads ? foldThreadReplies(peerFolded) : peerFolded;
  }, [messages, foldThreads]);
  const reactionView = useMemo(() => {
    const mentionView = projectBotMentions(
      expandPeerReplies(peerTranscript, expandedPeerMarkers)
        .map((message) => {
          const dismissed = dismissedChoiceQuestions.get(message.id);
          if (!dismissed) return message;
          const blocks = applyLocalChoiceDismissals(message.blocks, dismissed);
          return blocks === message.blocks ? message : { ...message, blocks: [...blocks] };
        })
        .filter((message) => hasVisibleMessagePresentation(message.blocks)),
    );
    return {
      ...projectMessageReactions(mentionView.visibleMessages),
      mentions: mentionView.mentions,
      foldedInto: mentionView.foldedInto,
    };
  }, [dismissedChoiceQuestions, expandedPeerMarkers, peerTranscript]);

  function dismissChoice(messageId: string, question: string) {
    setDismissedChoiceQuestions((current) => {
      const existing = current.get(messageId);
      if (existing?.has(question)) return current;
      const next = new Map(current);
      const questions = new Set(existing);
      questions.add(question);
      next.set(messageId, questions);
      return next;
    });
  }

  function togglePeerReplies(markerId: string) {
    setExpandedPeerMarkers((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(markerId)) next.add(markerId);
      return next;
    });
  }

  return {
    showBotSenderName,
    peerTranscript,
    reactionView,
    expandedPeerMarkers,
    setExpandedPeerMarkers,
    dismissChoice,
    togglePeerReplies,
  };
}
