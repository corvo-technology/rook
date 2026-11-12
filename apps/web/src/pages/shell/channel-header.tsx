import type { GroupMember } from "@corvo/contracts";
import { BotAvatar, Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Columns3, Menu, Plus } from "lucide-react";
import { IconTooltip } from "../../components/IconTooltip";
import { workingMembers } from "../../lib/roster-status";

/** How many faces the strip shows before the count says the rest. */
const MEMBER_FACES = 5;

/**
 * A channel's bar: its name behind a hash, the one line it is for, and the agents in it up top,
 * the way a chat app shows a room.
 */
export function ChannelHeader({
  name,
  purpose,
  members,
  onOpenNavigation,
  onOpenSettings,
  onOpenSquad,
}: {
  name: string;
  purpose: string | null | undefined;
  members: readonly GroupMember[];
  onOpenNavigation: () => void;
  onOpenSettings: () => void;
  onOpenSquad: () => void;
}) {
  const { t } = useLingui();
  const count = members.length;
  const working = workingMembers(members);
  // Whoever is working comes first, so a busy member is never hidden behind the count.
  const faces = [...working, ...members.filter((member) => !working.includes(member))];
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-3 py-2 md:px-[22px]">
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
      <div className="app-no-drag ms-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t`${count} agents`}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center" aria-hidden="true">
            {faces.slice(0, MEMBER_FACES).map((member, index, shown) => (
              <span
                key={member.botId}
                // The first face is on top, so whoever is working is never covered by a neighbour.
                style={{ zIndex: shown.length - index }}
                className={`relative rounded-lg ring-2 ring-background ${index === 0 ? "" : "-ms-2"}`}
              >
                <BotAvatar
                  color={member.color}
                  identity={member.botId}
                  size={24}
                  live
                  status={working.includes(member) ? member.status : undefined}
                />
              </span>
            ))}
          </span>
          {working.length > 0 ? (
            <span
              role="status"
              data-testid="channel-working"
              className="sr-only text-[13px] text-muted-foreground text-shimmer sm:not-sr-only"
            >
              {`${working[0]?.name}${working.length > 1 ? ` +${working.length - 1}` : ""} · ${t`Working…`}`}
            </span>
          ) : (
            <span className="hidden text-[13px] text-muted-foreground sm:inline">
              {t`${count} agents`}
            </span>
          )}
        </button>
        <IconTooltip label={t`Add agents`}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t`Add agents`}
            onClick={onOpenSettings}
          >
            <Plus strokeWidth={1.7} className="size-4" />
          </Button>
        </IconTooltip>
        <IconTooltip label={t`Squad`}>
          <Button variant="ghost" size="icon-sm" aria-label={t`Squad`} onClick={onOpenSquad}>
            <Columns3 strokeWidth={1.6} className="size-[17px]" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}
