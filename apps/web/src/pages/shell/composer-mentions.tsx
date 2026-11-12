import type { ComposerMention, SlashActionId } from "@corvo/core";
import { mentionChipKey } from "@corvo/core";
import { BotAvatar } from "@corvo/ui-web";
import { t } from "@lingui/core/macro";
import { Clock, Puzzle, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { FALLBACK_BOT_COLOR } from "./chat-shared";

export function slashActionLabel(id: SlashActionId) {
  switch (id) {
    case "chat-settings":
      return t`Chat Settings`;
    case "settings-general":
      return t`Settings: General`;
    case "settings-usage":
      return t`Settings: Usage`;
  }
}

export function MentionOptionIcon({ mention }: { mention: ComposerMention }) {
  if (mention.kind === "routine") {
    return <Clock size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted-foreground" />;
  }
  if (mention.kind === "connector") {
    return <Puzzle size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted-foreground" />;
  }
  if (mention.kind === "group") {
    return (
      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-[9px] text-foreground/75">
        G
      </span>
    );
  }
  if (mention.kind === "everyone") {
    return (
      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-[9px] text-foreground/75">
        @
      </span>
    );
  }
  return <BotAvatar color={mention.color ?? FALLBACK_BOT_COLOR} identity={mention.id} size={16} />;
}

/** The `@` suggestions above a composer; the caller owns the query, highlight and what a pick does. */
export function MentionPicker({
  id,
  options,
  activeIndex,
  onHighlight,
  onPick,
}: {
  id: string;
  options: readonly ComposerMention[];
  activeIndex: number;
  onHighlight: (mention: ComposerMention) => void;
  onPick: (mention: ComposerMention) => void;
}) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={t`Mentions`}
      data-testid="mention-picker"
      className="mb-2 overflow-hidden rounded-[14px] border border-border bg-muted animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
    >
      {options.map((mention, index) => {
        const highlighted = index === activeIndex;
        return (
          <button
            id={`${id}-option-${index}`}
            key={mentionChipKey(mention)}
            type="button"
            role="option"
            aria-selected={highlighted}
            aria-label={t`@${mention.name}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(mention)}
            // Opening the list under a stationary pointer must not steal the keyboard highlight.
            onMouseMove={() => onHighlight(mention)}
            className={`flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent ${
              highlighted ? "bg-accent" : ""
            }`}
          >
            <MentionOptionIcon mention={mention} />
            <span className="min-w-0">
              <span dir="auto" className="block text-[14px] text-foreground">
                @{mention.name}
              </span>
              {mention.subtitle ? (
                <span dir="auto" className="block truncate text-[12.5px] text-muted-foreground">
                  {mention.subtitle}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MentionChipIcon({ mention }: { mention: ComposerMention }) {
  if (mention.kind === "routine") {
    return <Clock size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />;
  }
  if (mention.kind === "connector") {
    return <Puzzle size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />;
  }
  if (mention.kind === "group" || mention.kind === "everyone") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-[9px] text-foreground/75">
        {mention.kind === "group" ? "G" : "@"}
      </span>
    );
  }
  return <BotAvatar color={mention.color ?? FALLBACK_BOT_COLOR} identity={mention.id} size={16} />;
}

/** An inline skill or mention token in the composer field. */
export function ComposerChip({
  icon,
  label,
  removeLabel,
  onRemove,
  ...props
}: {
  icon: ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
} & ComponentProps<"span">) {
  return (
    <span
      {...props}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] text-foreground"
    >
      {icon}
      <span dir="auto" className="truncate">
        {label}
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </span>
  );
}
