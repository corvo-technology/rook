import type { GroupMember } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Columns3, Menu } from "lucide-react";
import type { ReactNode } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { workingMembers } from "../../lib/roster-status";

/**
 * A channel's bar: its name behind a hash, the one line it is for, and on the right its search,
 * its pins and who is in it.
 */
export function ChannelHeader({
  name,
  purpose,
  members,
  onOpenNavigation,
  onOpenSettings,
  onOpenSquad,
  onOpenMembers,
  membersOpen = false,
  peopleCount,
  find,
}: {
  name: string;
  purpose: string | null | undefined;
  members: readonly GroupMember[];
  onOpenNavigation: () => void;
  onOpenSettings: () => void;
  onOpenSquad: () => void;
  /** Opens or closes the panel of who sees the channel. */
  onOpenMembers?: () => void;
  membersOpen?: boolean;
  /** How many people see the channel, beside its agents. */
  peopleCount?: number;
  /** The channel's search and pinned messages. */
  find?: ReactNode;
}) {
  const { t } = useLingui();
  const working = workingMembers(members);
  // Every agent counts, and so does every person who sees the channel.
  const total = members.length + (peopleCount ?? 0);
  return (
    <div className="app-drag flex shrink-0 items-center gap-3 border-b border-border bg-background px-3 py-2 md:px-[22px]">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t`Open navigation`}
        onClick={onOpenNavigation}
        className="app-no-drag md:hidden"
      >
        <Menu strokeWidth={1.7} className="size-[19px]" />
      </Button>
      <button
        type="button"
        data-testid="bot-settings-trigger"
        onClick={onOpenSettings}
        className="app-no-drag flex min-w-0 items-baseline gap-1.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="text-[17px] text-muted-foreground">
          #
        </span>
        <span className="truncate text-[15px] font-semibold text-foreground" dir="auto">
          {name}
        </span>
      </button>
      {purpose ? (
        <span
          dir="auto"
          className="hidden min-w-0 flex-1 truncate border-s border-border ps-3 text-[13px] text-muted-foreground md:block"
        >
          {purpose}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <div className="app-no-drag ms-auto flex shrink-0 items-center gap-2">
        {working.length > 0 ? (
          <span
            role="status"
            data-testid="channel-working"
            className="sr-only text-[13px] text-muted-foreground text-shimmer sm:not-sr-only"
          >
            {`${working[0]?.name}${working.length > 1 ? ` +${working.length - 1}` : ""} · ${t`Working…`}`}
          </span>
        ) : null}
        {find}
        {onOpenMembers ? (
          <Button
            variant="outline"
            aria-label={t`Members`}
            aria-pressed={membersOpen}
            data-testid="channel-members-toggle"
            onClick={onOpenMembers}
            className={`h-9 rounded-[10px] px-3 text-[13px] font-medium ${membersOpen ? "bg-accent" : ""}`}
          >
            {t`${total} members`}
          </Button>
        ) : null}
        <IconTooltip label={t`Squad`}>
          <Button variant="ghost" size="icon-sm" aria-label={t`Squad`} onClick={onOpenSquad}>
            <Columns3 strokeWidth={1.6} className="size-[17px]" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}
