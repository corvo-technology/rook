import type { AppNotification, NotificationKind } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { LucideIcon } from "lucide-react";
import {
  AtSign,
  CheckCheck,
  CircleAlert,
  CircleHelp,
  Info,
  Mail,
  Reply,
  ShieldCheck,
  SquareActivity,
} from "lucide-react";
import { groupInbox, relativeTime } from "../lib/inbox";
import { IconTooltip } from "./IconTooltip";
import { PersonAvatar } from "./PersonAvatar";

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  mention: AtSign,
  reply: Reply,
  dm: Mail,
  approval: ShieldCheck,
  question: CircleHelp,
  failure: CircleAlert,
  alert: Info,
};

/** What needs the reader, newest conversations with something unread first. */
export function InboxPanel({
  items,
  unreadCount,
  now,
  onOpen,
  onMarkAllRead,
  onActivity,
}: {
  items: readonly AppNotification[];
  unreadCount: number;
  now: number;
  onOpen: (item: AppNotification) => void;
  onMarkAllRead: () => void;
  onActivity: () => void;
}) {
  const { t, i18n } = useLingui();
  const labels: Record<NotificationKind, string> = {
    mention: t`Mention`,
    reply: t`Reply`,
    dm: t`Direct message`,
    approval: t`Approval`,
    question: t`Question`,
    failure: t`Failed`,
    alert: t`Alert`,
  };
  const groups = groupInbox(items);
  return (
    <div data-testid="inbox-panel" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <h2 className="text-sm font-medium">{t`Inbox`}</h2>
        <div className="flex items-center">
          <IconTooltip label={t`Mark all read`}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Mark all read`}
              disabled={unreadCount === 0}
              onClick={onMarkAllRead}
            >
              <CheckCheck size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </IconTooltip>
          <IconTooltip label={t`Activity`}>
            <Button variant="ghost" size="icon-sm" aria-label={t`Activity`} onClick={onActivity}>
              <SquareActivity size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </IconTooltip>
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t`All caught up`}</p>
      ) : (
        <ul className="rk-scroll flex min-h-0 flex-col overflow-y-auto">
          {groups.map((group) => (
            <li key={group.key} className="border-t border-border first:border-t-0">
              <ul>
                {group.items.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  const text = item.kind === "alert" ? (item.detail ?? item.preview) : item.preview;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-inbox-item={item.read ? "read" : "unread"}
                        onClick={() => onOpen(item)}
                        className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <PersonAvatar
                          name={item.actor?.name ?? item.source}
                          image={item.actor?.image}
                          size={28}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5">
                            <Icon
                              size={12}
                              strokeWidth={1.75}
                              aria-label={labels[item.kind]}
                              role="img"
                              className="shrink-0 text-muted-foreground"
                            />
                            <span
                              className={`min-w-0 flex-1 truncate text-sm ${item.read ? "text-muted-foreground" : "font-semibold"}`}
                            >
                              {item.source}
                            </span>
                            <time
                              dateTime={item.createdAt}
                              className="shrink-0 text-meta tabular-nums text-muted-foreground"
                            >
                              {relativeTime(item.createdAt, now, i18n.locale || "en")}
                            </time>
                            {item.read ? null : (
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full bg-unread"
                              />
                            )}
                          </span>
                          {text ? (
                            <span
                              className={`line-clamp-2 text-xs ${item.read ? "text-muted-foreground" : "text-foreground"}`}
                            >
                              {text}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
