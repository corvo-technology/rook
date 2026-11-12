import type { ThreadMessage } from "@corvo/contracts";
import type { ComposerMention, FoldedTranscript } from "@corvo/core";
import {
  clampMentionHighlightIndex,
  filterMentionOptions,
  mentionChipKey,
  newClientId,
  resolveMentionPickerKey,
  serializeComposerPrompt,
} from "@corvo/core";
import type { GroupAvatarMember } from "@corvo/ui-web";
import { Button, Textarea } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUp, X } from "lucide-react";
import type { ComponentProps, RefObject } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WorkingLine } from "../../components/WorkingLine";
import { errorText } from "../../lib/user-error";
import { FALLBACK_BOT_COLOR } from "./chat-shared";
import { ComposerChip, MentionChipIcon, MentionPicker } from "./composer-mentions";
import { Transcript } from "./transcript";

type TranscriptProps = ComponentProps<typeof Transcript>;

/** What a thread shares with the channel's own transcript: how a message is drawn and answered. */
export type ThreadTranscriptProps = Pick<
  TranscriptProps,
  | "artifactTarget"
  | "showToolActivity"
  | "answerableAskIds"
  | "dismissableAskIds"
  | "userBubble"
  | "onOpenBot"
  | "onAnswer"
  | "onMarkUnread"
  | "onKeepInWiki"
  | "onReact"
  | "onJumpToMessage"
  | "onOpenPeerMessages"
  | "memberName"
  | "members"
  | "peerBot"
  | "onRefresh"
  | "onBotChanged"
  | "onAddRoutine"
  | "voiceReady"
  | "speakingMessageId"
  | "onSpeak"
  | "onOpenComputer"
  | "onOpenImportSetup"
  | "onOpenImport"
>;

const noReplies: FoldedTranscript<ThreadMessage>["folded"] = new Map();
const noIds: ReadonlyMap<string, string> = new Map();

/**
 * A channel message and its replies beside the channel, with a composer that answers into it.
 * Focus moves to the composer on opening and goes back to what opened the thread on closing.
 */
export function ThreadPanel({
  root,
  replies,
  transcriptProps,
  scrollRequest,
  onScrollRequestHandled,
  enterToSend,
  mentionTargets,
  onSend,
  onClose,
}: {
  root: ThreadMessage;
  replies: readonly ThreadMessage[];
  transcriptProps: ThreadTranscriptProps;
  scrollRequest: { messageId: string; nonce: number } | null;
  onScrollRequestHandled: () => void;
  enterToSend: boolean;
  /** What `@` offers; a thread only wakes agents, so channels, routines and the like are left out. */
  mentionTargets: ComposerMention[];
  /** Posts into the thread; rejects when the message was not accepted. */
  onSend: (text: string, mentions: ComposerMention[], clientNonce: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcript = useMemo<FoldedTranscript<ThreadMessage>>(
    () => ({
      messages: [root, ...replies],
      folded: noReplies,
      markerOf: noIds,
      mergedInto: noIds,
    }),
    [root, replies],
  );
  const { peerBot } = transcriptProps;
  // Agents answering in this thread, as far as the live drafts say: the thread's own working line.
  const workingBots = useMemo<GroupAvatarMember[]>(() => {
    const ids = new Set(
      replies.flatMap((reply) =>
        reply.id.startsWith("progress:") && reply.botId ? [reply.botId] : [],
      ),
    );
    return [...ids].map((botId) => ({
      botId,
      name: transcriptProps.memberName?.(botId) ?? peerBot(botId)?.name,
      color: peerBot(botId)?.color ?? FALLBACK_BOT_COLOR,
      status: "running",
    }));
  }, [replies, peerBot, transcriptProps]);

  useEffect(() => {
    const opener = document.activeElement;
    textareaRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <section
      aria-label={t`Thread`}
      data-testid="thread-panel"
      className="flex h-full min-h-0 w-full flex-col"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <ThreadHeader onClose={onClose} />
      <Transcript
        {...transcriptProps}
        variant="thread"
        scrollRef={scrollRef}
        scrollRequest={scrollRequest}
        onScrollRequestHandled={onScrollRequestHandled}
        transcript={transcript}
        olderCursor={null}
        unreadAfterSeq={null}
        loadingOlder={false}
        running={false}
        workingBots={[]}
        onLoadOlder={() => undefined}
      />
      <div className="flex flex-col gap-1.5 px-3 pt-1 pb-3">
        <WorkingLine bots={workingBots} />
        <ThreadComposer
          textareaRef={textareaRef}
          enterToSend={enterToSend}
          rootId={root.id}
          mentionTargets={mentionTargets}
          onSend={onSend}
        />
      </div>
    </section>
  );
}

function ThreadHeader({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  return (
    <div className="flex shrink-0 items-center justify-between px-5 py-[17px]">
      <h2 className="text-[15px] font-semibold text-foreground">
        <Trans>Thread</Trans>
      </h2>
      <Button variant="ghost" size="icon-sm" aria-label={t`Close panel`} onClick={onClose}>
        <X size={16} strokeWidth={1.8} />
      </Button>
    </div>
  );
}

function ThreadComposer({
  textareaRef,
  enterToSend,
  rootId,
  mentionTargets,
  onSend,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enterToSend: boolean;
  rootId: string;
  mentionTargets: ComposerMention[];
  onSend: (text: string, mentions: ComposerMention[], clientNonce: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const listboxId = useId();
  const mentionOptions = useMemo(
    () => filterMentionOptions(mentionTargets, mentionQuery),
    [mentionTargets, mentionQuery],
  );
  const activeIndex = clampMentionHighlightIndex(
    mentionOptions.findIndex((mention) => mentionChipKey(mention) === highlightKey),
    mentionOptions.length,
  );
  // One nonce per draft, so a retry after a dropped connection never posts it twice.
  const nonce = useRef(newClientId());
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function edit(value: string) {
    nonce.current = newClientId();
    setDraft(value);
    const match = /(?:^|\s)@([\w-]*)$/.exec(value);
    setMentionQuery(match ? (match[1] ?? "") : null);
    setHighlightKey(null);
  }

  function pick(mention: ComposerMention) {
    nonce.current = newClientId();
    setDraft((current) => current.replace(/@([\w-]*)$/, ""));
    setMentionQuery(null);
    setHighlightKey(null);
    setMentions((current) =>
      current.some((chip) => mentionChipKey(chip) === mentionChipKey(mention))
        ? current
        : [...current, mention],
    );
    textareaRef.current?.focus();
  }

  async function send() {
    const text = serializeComposerPrompt(draft, null, mentions).trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(text, mentions, nonce.current);
      nonce.current = newClientId();
      if (mounted.current) {
        setDraft("");
        setMentions([]);
        setMentionQuery(null);
      }
    } catch (failure) {
      if (mounted.current) setError(errorText(failure, t`Failed to send message`));
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="mb-1 px-1 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {mentionOptions.length > 0 ? (
        <MentionPicker
          id={listboxId}
          options={mentionOptions}
          activeIndex={activeIndex}
          onHighlight={(mention) => setHighlightKey(mentionChipKey(mention))}
          onPick={pick}
        />
      ) : null}
      <div className="flex items-end gap-2 rounded-[20px] border border-border bg-background py-1.5 ps-3.5 pe-2 focus-within:border-input">
        {mentions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 self-center">
            {mentions.map((mention) => (
              <ComposerChip
                key={mentionChipKey(mention)}
                data-testid="mention-chip"
                data-mention-kind={mention.kind}
                icon={<MentionChipIcon mention={mention} />}
                label={mention.name}
                removeLabel={t`Remove mention ${mention.name}`}
                onRemove={() =>
                  setMentions((current) =>
                    current.filter((chip) => mentionChipKey(chip) !== mentionChipKey(mention)),
                  )
                }
              />
            ))}
          </div>
        ) : null}
        <Textarea
          ref={textareaRef}
          key={rootId}
          aria-label={t`Reply`}
          name="thread-reply"
          autoComplete="off"
          dir="auto"
          rows={1}
          value={draft}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && draft.length === 0 && mentions.length > 0) {
              event.preventDefault();
              setMentions((current) => current.slice(0, -1));
              return;
            }
            const action = resolveMentionPickerKey({
              key: event.key,
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              enterToSend,
              isComposing: event.nativeEvent.isComposing || event.keyCode === 229,
              optionCount: mentionOptions.length,
              highlightedIndex: activeIndex,
            });
            if (action.type === "complete") {
              const mention = mentionOptions[action.index];
              if (!mention) return;
              event.preventDefault();
              pick(mention);
            } else if (action.type === "move") {
              event.preventDefault();
              setHighlightKey(mentionChipKey(mentionOptions[action.index]!));
            } else if (action.type === "dismiss") {
              event.preventDefault();
              setMentionQuery(null);
              setHighlightKey(null);
            } else if (action.type === "send") {
              event.preventDefault();
              void send();
            }
          }}
          className="rk-scroll max-h-25 min-h-6 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-body1 shadow-none focus-visible:ring-0"
        />
        <Button
          size="icon"
          aria-label={t`Send`}
          disabled={sending || (draft.trim().length === 0 && mentions.length === 0)}
          onClick={() => void send()}
          className="size-8 shrink-0 rounded-full disabled:bg-primary-disabled disabled:text-foreground/30 disabled:opacity-100"
        >
          <ArrowUp size={16} strokeWidth={2.2} />
        </Button>
      </div>
    </div>
  );
}
