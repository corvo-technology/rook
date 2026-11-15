import type { AppNotification } from "@corvo/contracts";
import { unreadBadgeText } from "@corvo/contracts";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Bell } from "lucide-react";
import { useState } from "react";
import { inboxPath, useInbox } from "../lib/inbox";
import { InboxPanel } from "./InboxPanel";

/** The bell of the sidebar footer: opens the inbox, with what is unread counted on it. */
export function InboxBell({
  navigate,
  onActivity,
}: {
  navigate: (path: string) => void;
  onActivity: () => void;
}) {
  const { t } = useLingui();
  const inbox = useInbox();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="sidebar-bell"
            aria-label={t`Notifications`}
            className="relative shrink-0 rounded-md text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Bell
          size={16}
          strokeWidth={1.75}
          fill={open ? "currentColor" : "none"}
          aria-hidden="true"
        />
        {inbox.unreadCount > 0 ? (
          <span
            data-testid="inbox-unread"
            className="absolute -end-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-caption font-semibold tabular-nums text-primary-foreground"
          >
            {unreadBadgeText(inbox.unreadCount)}
          </span>
        ) : null}
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          side="top"
          sideOffset={8}
          align="end"
          className="max-h-(--available-height) w-[340px] max-w-[calc(100vw-32px)] gap-0 p-1 data-closed:animate-none"
        >
          <InboxPanel
            items={inbox.items}
            unreadCount={inbox.unreadCount}
            now={Date.now()}
            onMarkAllRead={() => void inbox.markAllRead()}
            onActivity={() => {
              setOpen(false);
              onActivity();
            }}
            onOpen={(item: AppNotification) => {
              if (!item.read) void inbox.markRead([item.id]);
              const path = inboxPath(item);
              setOpen(false);
              if (path) navigate(path);
            }}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
