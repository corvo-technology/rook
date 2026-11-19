import type { Bot } from "@corvo/contracts";
import { BotAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { LucideIcon } from "lucide-react";
import { CalendarClock, Home, ListChecks, MessageCircle, Users } from "lucide-react";
import type { EmbedTabId } from "../../lib/embedded-home";
import { activeEmbedTab, EMBED_TAB_PATHS } from "../../lib/embedded-home";

const ICONS: Record<EmbedTabId, LucideIcon> = {
  home: Home,
  chats: MessageCircle,
  board: ListChecks,
  routines: CalendarClock,
  team: Users,
};

/**
 * What stands in for the sidebar inside a partner's product: the Chief by its name, then the few
 * areas a customer needs. It scrolls sideways on a narrow frame instead of wrapping, and the
 * current tab is marked in the partner's colour.
 */
export function EmbedTabs({
  tabs,
  pathname,
  chief,
  onOpen,
}: {
  tabs: readonly EmbedTabId[];
  pathname: string;
  chief?: Pick<Bot, "id" | "name" | "color">;
  onOpen: (to: string) => void;
}) {
  const { t } = useLingui();
  const labels: Record<EmbedTabId, string> = {
    home: t`Home`,
    chats: t`Chats`,
    board: t`Tasks`,
    routines: t`Routines`,
    team: t`Agents`,
  };
  const active = activeEmbedTab(pathname);
  return (
    <header
      data-testid="embed-tabs"
      className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-background px-3 sm:px-4"
    >
      {chief ? (
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <BotAvatar color={chief.color} identity={chief.id} size={24} />
          <span className="max-w-44 truncate text-sm font-semibold">{chief.name}</span>
        </div>
      ) : null}
      <nav
        aria-label={chief?.name ?? "Rook"}
        className="rk-scroll -mb-px flex h-full min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
      >
        {tabs.map((id) => {
          const Icon = ICONS[id];
          const current = id === active;
          return (
            <button
              key={id}
              type="button"
              data-testid={`embed-tab-${id}`}
              aria-current={current ? "page" : undefined}
              onClick={() => onOpen(EMBED_TAB_PATHS[id])}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
                current ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon aria-hidden className="size-4" strokeWidth={1.8} />
              {labels[id]}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-0 h-0.5 origin-left rounded-full bg-primary transition-transform duration-300 ease-out ${
                  current ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          );
        })}
      </nav>
    </header>
  );
}

/** The frame before the session opens: the bar and the Home laid out in quiet blocks. */
export function EmbedSkeleton() {
  const block = "animate-pulse rounded-xl bg-muted motion-reduce:animate-none";
  return (
    <div
      data-corvo-app-state="embed-pending"
      aria-hidden
      className="flex h-full flex-col bg-background"
    >
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <div className="size-6 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`${block} h-4 w-16`} />
        ))}
      </div>
      <EmbedHomeSkeleton />
    </div>
  );
}

/** The Home before its data lands. */
export function EmbedHomeSkeleton() {
  const block = "animate-pulse rounded-xl bg-muted motion-reduce:animate-none";
  return (
    <div aria-hidden className="h-full bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-8">
        <div className={`${block} h-9 w-2/3`} />
        <div className={`${block} h-28`} />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${block} h-14`} />
          ))}
        </div>
      </div>
    </div>
  );
}
