import type { GroupAvatarMember } from "@corvo/ui-web";
import { BotAvatar, Button, GroupAvatar } from "@corvo/ui-web";
import { ChevronDown } from "lucide-react";

/**
 * Lightweight peer event shown without exposing the exchanged message body. `replies` adds a
 * toggle for the peer run's folded replies.
 */
export function CollaborationMarker({
  ariaLabel,
  color,
  identity,
  label,
  onClick,
  replies,
  state,
}: {
  ariaLabel: string;
  color: string;
  identity: string;
  label: string;
  onClick: () => void;
  replies?: { expanded: boolean; label: string; onToggle: () => void };
  /** Where delegated work stands, shown after the label. */
  state?: { kind: "working" | "waiting" | "answered"; label: string };
}) {
  return (
    <div className="flex justify-start">
      <button
        type="button"
        data-testid="peer-receipt-chip"
        aria-label={ariaLabel}
        onClick={onClick}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground/75"
      >
        <BotAvatar color={color} identity={identity} size={16} />
        <span dir="auto" className="truncate">
          {label}
        </span>
        {state ? (
          <span
            data-testid="peer-state"
            data-state={state.kind}
            className={
              state.kind === "working"
                ? "shrink-0 text-shimmer"
                : state.kind === "answered"
                  ? "flex shrink-0 items-center gap-1 text-foreground/75"
                  : "shrink-0"
            }
          >
            · {state.label}
          </span>
        ) : null}
      </button>
      {replies ? (
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="peer-replies-toggle"
          aria-expanded={replies.expanded}
          aria-label={replies.label}
          onClick={replies.onToggle}
          className="rounded-full text-muted-foreground"
        >
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className={
              replies.expanded
                ? "size-3.5 transition-transform"
                : "size-3.5 -rotate-90 transition-transform"
            }
            aria-hidden="true"
          />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The working bot with what it is doing right now, such as its current tool call. The ring of dots
 * on its rook is the only motion; the label stays still so it can be read.
 */
export function ActiveBotGlyph({ bots, label }: { bots: GroupAvatarMember[]; label: string }) {
  return (
    <div role="status" className="corvo-message-in flex min-h-10 min-w-0 items-center gap-2.5 px-1">
      <GroupAvatar members={bots} size={34} />
      <span dir="auto" className="min-w-0 truncate text-[15px] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
