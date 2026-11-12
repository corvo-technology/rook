import { BotAvatar } from "@corvo/ui-web";
import { ChevronRight } from "lucide-react";

/**
 * What a message with replies shows beneath it: who replied, how many replies and when the last
 * came. Pressing it opens the thread beside the channel.
 */
export function ThreadFooter({
  open,
  countLabel,
  faces,
  lastAt,
  lastLabel,
  onOpen,
}: {
  /** Whether this thread is the one open beside the channel. */
  open: boolean;
  /** "3 replies". */
  countLabel: string;
  faces: readonly { botId: string; color: string }[];
  lastAt: string;
  /** The time of the last reply, as the reader writes it. */
  lastLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="flex justify-start">
      <button
        type="button"
        data-testid="thread-footer"
        aria-expanded={open}
        onClick={onOpen}
        className="group/thread -ms-1 inline-flex max-w-full items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/75 motion-reduce:transition-none"
      >
        <span className="flex items-center" aria-hidden="true">
          {faces.map((face, index) => (
            <BotAvatar
              key={face.botId}
              color={face.color}
              identity={face.botId}
              size={18}
              className={index === 0 ? undefined : "-ms-1"}
            />
          ))}
        </span>
        <span className="font-medium text-foreground/75">{countLabel}</span>
        <time dateTime={lastAt} className="tabular-nums">
          {lastLabel}
        </time>
        <ChevronRight
          strokeWidth={1.8}
          aria-hidden="true"
          className="size-3.5 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-visible/thread:opacity-100 motion-reduce:transition-none rtl:rotate-180"
        />
      </button>
    </div>
  );
}
