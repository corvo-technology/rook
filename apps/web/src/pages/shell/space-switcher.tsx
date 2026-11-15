import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

type SwitcherSpace = {
  id: string;
  name: string;
  bots: readonly { id: string; unread?: boolean }[];
};

/** Where a space opens: its first chat, or the setup page while it has none. */
function spaceLanding(space: SwitcherSpace) {
  const first = space.bots[0];
  return first ? `/app/${first.id}` : "/onboarding";
}

/** Switches between the account's spaces, or starts a new one, from the top of the sidebar. */
export function SpaceSwitcher({
  mini = false,
  summary,
  spaces,
  currentSpaceId,
  onSelect,
  onCreate,
}: {
  mini?: boolean;
  /** What the space holds, under its name; absent for a space of one. */
  summary?: string;
  spaces: readonly SwitcherSpace[];
  currentSpaceId: string | null;
  onSelect: (spaceId: string, path: string) => void;
  /** Absent when this person may not create spaces. */
  onCreate?: () => void;
}) {
  const { t } = useLingui();
  const current = spaces.find((space) => space.id === currentSpaceId) ?? spaces[0];
  if (!current) return null;
  const otherUnread = spaces.some(
    (space) => space.id !== current.id && space.bots.some((bot) => bot.unread),
  );
  return (
    <div className={mini ? "flex justify-center pb-2" : "px-2.5 pb-2"}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t`Switch space`}
          data-testid="space-switcher"
          className={`app-no-drag relative flex items-center text-start outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            mini
              ? "size-9 justify-center rounded-xl bg-card text-sm font-medium"
              : `min-h-11 py-1 w-full gap-2.5 rounded-xl px-2.5 hover:bg-accent`
          }`}
        >
          {mini ? (
            <span aria-hidden="true">{current.name.trim().charAt(0).toUpperCase()}</span>
          ) : (
            <>
              <span
                aria-hidden="true"
                className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-primary font-semibold text-primary-foreground"
              >
                {current.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[15px] font-semibold">{current.name}</span>
                {summary ? (
                  <span
                    data-testid="space-summary"
                    className="truncate text-[12px] text-muted-foreground"
                  >
                    {summary}
                  </span>
                ) : null}
              </span>
              <ChevronsUpDown
                size={14}
                strokeWidth={1.8}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </>
          )}
          {otherUnread ? (
            <span
              data-testid="space-switcher-unread"
              aria-hidden="true"
              className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="app-no-drag w-56">
          {spaces.map((space) => (
            <DropdownMenuItem
              key={space.id}
              data-testid={`space-switcher-item-${space.id}`}
              onClick={() => {
                if (space.id !== current.id) onSelect(space.id, spaceLanding(space));
              }}
              className="gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              {space.id !== current.id && space.bots.some((bot) => bot.unread) ? (
                <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              ) : null}
              {space.id === current.id ? (
                <Check size={14} strokeWidth={1.8} aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))}
          {onCreate ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="space-switcher-new"
                onClick={onCreate}
                className="gap-2"
              >
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                <Trans>New space</Trans>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
