import type { MessageVariants, ThreadMessage } from "@corvo/contracts";
import { Button, Textarea } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { copyableMessageText } from "../../lib/message-text";

/** What a single-agent chat does with versions of its messages; absent where messages have none. */
export interface MessageVersions {
  /** A reply is being written: nothing can be edited, redone or switched until it stops. */
  busy: boolean;
  /** The newest reply of the agent, the one that can be answered again. */
  lastReplyId?: string;
  onEdit: (message: ThreadMessage, text: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onFork: (message: ThreadMessage) => Promise<void>;
  onSwitch: (branchId: string | null) => Promise<void>;
}

export const messageText = (message: ThreadMessage) => copyableMessageText(message);

/** "‹ 1 of 2 ›" under the message that opens one of several versions of the same point. */
export function VersionSwitcher({
  variants,
  disabled,
  onSwitch,
}: {
  variants: MessageVariants;
  disabled: boolean;
  onSwitch: (branchId: string | null) => Promise<void>;
}) {
  const { t } = useLingui();
  const step = (by: -1 | 1) => {
    const next = variants.branchIds[variants.index + by];
    if (next === undefined) return;
    void onSwitch(next);
  };
  const position = variants.index + 1;
  const count = variants.count;
  const arrow =
    "grid h-6 w-6 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div
      data-testid="version-switcher"
      className="mt-1 flex items-center gap-0.5 ps-11 text-xs text-muted-foreground"
    >
      <button
        type="button"
        aria-label={t`Previous version`}
        disabled={disabled || variants.index === 0}
        onClick={() => step(-1)}
        className={arrow}
      >
        <ChevronLeft size={14} strokeWidth={1.7} />
      </button>
      <span className="tabular-nums">{t`${position} of ${count}`}</span>
      <button
        type="button"
        aria-label={t`Next version`}
        disabled={disabled || variants.index === count - 1}
        onClick={() => step(1)}
        className={arrow}
      >
        <ChevronRight size={14} strokeWidth={1.7} />
      </button>
    </div>
  );
}

/** The person's message turned into a field; saving sends the new text as a new version. */
export function MessageEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const trimmed = text.trim();
  const save = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
      onCancel();
    } catch {
      // The failure shows where send failures do; the text stays here to try again.
      setSaving(false);
    }
  };
  return (
    <div data-testid="message-editor" className="ms-auto flex w-full max-w-xl flex-col gap-2">
      <Textarea
        autoFocus
        aria-label={t`Edit message`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="button" size="sm" disabled={!trimmed || saving} onClick={() => void save()}>
          <Trans>Save</Trans>
        </Button>
      </div>
    </div>
  );
}
