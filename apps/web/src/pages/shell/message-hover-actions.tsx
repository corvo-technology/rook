import type { MessageReaction, ThreadMessage } from "@corvo/contracts";
import { canReactToThreadMessage, MESSAGE_REACTIONS } from "@corvo/contracts";
import { canMarkMessageUnread } from "@corvo/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  BookOpen,
  Copy,
  MessageSquareDot,
  MessageSquareText,
  MoreHorizontal,
  Pin,
  PinOff,
  Reply,
  Smile,
  Square,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { MessageHoverMetadata } from "../../components/MessageHoverMetadata";
import { copyableMessageText } from "../../lib/message-text";

export function MessageHoverActions({
  message,
  speech,
  onReply,
  onReplyInThread,
  onMarkUnread,
  onKeepInWiki,
  markedUnread = false,
  onReact,
  onPin,
}: {
  message: ThreadMessage;
  /** Reads the reply aloud; absent where there is no voice or nothing to read. */
  speech?: { speaking: boolean; onSpeak: () => void };
  /** Quotes the message; absent where the composer has no quote to arm. */
  onReply?: (message: ThreadMessage) => void;
  /** Opens the message's thread; absent outside a channel's main column. */
  onReplyInThread?: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  onKeepInWiki?: (message: ThreadMessage) => void;
  markedUnread?: boolean;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
  /** Pins or unpins the message; absent where there is no pin list. */
  onPin?: (message: ThreadMessage, pinned: boolean) => Promise<void>;
}) {
  const { t } = useLingui();
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);

  // Streaming progress bubbles keep hover free for selection / stop clicks.
  if (message.id.startsWith("progress:")) return null;

  function copyMessage() {
    const text = copyableMessageText(message);
    if (!text || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }

  const iconButtonClass =
    "grid h-11 w-11 place-items-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)_and_(pointer:fine)]:h-6 [@media(hover:hover)_and_(pointer:fine)]:w-6";

  return (
    <MessageHoverMetadata pinned={moreOpen || reactionsOpen}>
      <div data-testid="message-hover-actions" className="flex items-center gap-0.5">
        {speech ? (
          <button
            type="button"
            aria-label={speech.speaking ? t`Stop speaking` : t`Speak this reply`}
            aria-pressed={speech.speaking}
            onClick={speech.onSpeak}
            className={iconButtonClass}
          >
            {speech.speaking ? (
              <Square size={14} strokeWidth={1.7} />
            ) : (
              <Volume2 size={15} strokeWidth={1.7} />
            )}
          </button>
        ) : null}
        {canReactToThreadMessage(message) ? (
          <Popover open={reactionsOpen} onOpenChange={setReactionsOpen}>
            <PopoverTrigger aria-label={t`React`} className={iconButtonClass}>
              <Smile size={15} strokeWidth={1.7} />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-auto flex-row gap-0 rounded-2xl p-1.5"
              aria-label={t`Reactions`}
            >
              {MESSAGE_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={emoji}
                  className="grid h-11 w-11 place-items-center rounded-xl text-2xl hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setReactionsOpen(false);
                    void onReact(message, emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
        {onReplyInThread ? (
          <button
            type="button"
            aria-label={t`Reply in thread`}
            onClick={() => onReplyInThread(message)}
            className={iconButtonClass}
          >
            <MessageSquareText size={15} strokeWidth={1.7} />
          </button>
        ) : null}
        {onReply ? (
          <button
            type="button"
            aria-label={t`Reply`}
            onClick={() => onReply(message)}
            className={iconButtonClass}
          >
            <Reply size={15} strokeWidth={1.7} />
          </button>
        ) : null}
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger aria-label={t`More`} className={iconButtonClass}>
            <MoreHorizontal size={15} strokeWidth={1.7} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            {onReply ? (
              <DropdownMenuItem
                onClick={() => {
                  setMoreOpen(false);
                  onReply(message);
                }}
              >
                <Reply size={14} strokeWidth={1.7} />
                <Trans>Reply</Trans>
              </DropdownMenuItem>
            ) : null}
            {onPin && canReactToThreadMessage(message) ? (
              <DropdownMenuItem
                onClick={() => {
                  setMoreOpen(false);
                  void onPin(message, !message.pinnedAt);
                }}
              >
                {message.pinnedAt ? (
                  <PinOff size={14} strokeWidth={1.7} />
                ) : (
                  <Pin size={14} strokeWidth={1.7} />
                )}
                {message.pinnedAt ? <Trans>Unpin</Trans> : <Trans>Pin</Trans>}
              </DropdownMenuItem>
            ) : null}
            {canMarkMessageUnread(message) && !markedUnread ? (
              <DropdownMenuItem
                onClick={() => {
                  setMoreOpen(false);
                  onMarkUnread(message);
                }}
              >
                <MessageSquareDot size={14} strokeWidth={1.7} />
                <Trans>Mark as unread</Trans>
              </DropdownMenuItem>
            ) : null}
            {onKeepInWiki && copyableMessageText(message) ? (
              <DropdownMenuItem
                onClick={() => {
                  setMoreOpen(false);
                  onKeepInWiki(message);
                }}
              >
                <BookOpen size={14} strokeWidth={1.7} />
                <Trans>Keep in the wiki</Trans>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={copyMessage}>
              <Copy size={14} strokeWidth={1.7} />
              <Trans>Copy</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </MessageHoverMetadata>
  );
}
