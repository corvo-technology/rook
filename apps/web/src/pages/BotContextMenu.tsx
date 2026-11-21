import type { Bot, BotSection, MuteDuration } from "@corvo/contracts";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import {
  Archive,
  Bell,
  BellDot,
  BellOff,
  Check,
  Copy,
  Eraser,
  Folder,
  FolderPlus,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";

type ChatMenuTarget = Pick<Bot, "name" | "pinned" | "sectionId" | "unread">;

/** A roster row's context menu content; `onClose` serves the lazy-load error fallback. */
export function BotContextMenu({
  bot,
  onTogglePinned,
  sections,
  onMoveToSection,
  onCreateSection,
  onRenameSection,
  onToggleUnread,
  muted,
  onMute,
  onEdit,
  onDuplicate,
  onClear,
  onArchive,
  onDelete,
}: {
  bot: ChatMenuTarget;
  onClose: () => void;
  onTogglePinned: () => void;
  sections: BotSection[];
  onMoveToSection: (sectionId: string | null) => void;
  onCreateSection: () => void;
  onRenameSection?: (sectionId: string) => void;
  onToggleUnread: () => void;
  /** Whether the pushes are silenced now; unknown until the mutes are read. */
  muted: boolean | undefined;
  /** Silences the pushes for a while, or turns them back on with null. */
  onMute: (duration: MuteDuration | null) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();

  return (
    <ContextMenuContent
      aria-label={t`Actions for ${bot.name}`}
      className="max-h-[min(420px,calc(100vh-16px))] w-[264px] overflow-y-auto"
    >
      <ContextMenuItem onClick={onTogglePinned}>
        <Pin />
        {bot.pinned ? t`Unpin` : t`Pin`}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Folder />
          {t`Move to`}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-[min(420px,calc(100vh-16px))] min-w-[180px] overflow-y-auto">
          {sections.map((section) => (
            <ContextMenuItem key={section.id} onClick={() => onMoveToSection(section.id)}>
              <Folder />
              <span dir="auto">{section.name}</span>
              {bot.sectionId === section.id ? <Check className="ms-auto" /> : null}
            </ContextMenuItem>
          ))}
          <ContextMenuItem onClick={() => onMoveToSection(null)}>
            <Folder />
            {t`Agents`}
            {bot.sectionId === null ? <Check className="ms-auto" /> : null}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCreateSection}>
            <FolderPlus />
            {t`New section`}
          </ContextMenuItem>
          {bot.sectionId && onRenameSection ? (
            <ContextMenuItem onClick={() => onRenameSection(bot.sectionId!)}>
              <Pencil />
              {t`Rename section`}
            </ContextMenuItem>
          ) : null}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onClick={onToggleUnread}>
        {bot.unread ? <BellDot /> : <Bell />}
        {bot.unread ? t`Mark as Read` : t`Mark as Unread`}
      </ContextMenuItem>
      {muted ? (
        <ContextMenuItem onClick={() => onMute(null)}>
          <BellOff />
          {t`Unmute`}
        </ContextMenuItem>
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={muted === undefined}>
            <BellOff />
            {t`Mute`}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[180px]">
            <ContextMenuItem onClick={() => onMute("hour")}>{t`For 1 hour`}</ContextMenuItem>
            <ContextMenuItem
              onClick={() => onMute("tomorrow")}
            >{t`Until tomorrow`}</ContextMenuItem>
            <ContextMenuItem onClick={() => onMute("forever")}>{t`Always`}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onEdit}>
        <Pencil />
        {t`Edit Profile`}
      </ContextMenuItem>
      <ContextMenuItem onClick={onDuplicate}>
        <Copy />
        {t`Duplicate`}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onClear}>
        <Eraser />
        {t`Clear conversation`}
      </ContextMenuItem>
      <ContextMenuItem onClick={onArchive}>
        <Archive />
        {t`Archive`}
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 />
        {t`Delete`}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
