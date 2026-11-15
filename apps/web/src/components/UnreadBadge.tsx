import { unreadBadgeText } from "@corvo/contracts";
import { Trans } from "@lingui/react/macro";

/**
 * The unread count of a conversation: a number (99+ at most), in the strong style when someone
 * is named in it, or the plain dot for an unread conversation that carries no count.
 */
export function UnreadBadge({
  count = 0,
  mentions = 0,
  unread,
}: {
  count?: number;
  mentions?: number;
  unread: boolean;
}) {
  // A chat read on this screen is no longer unread while its counts catch up.
  if (!unread) return null;
  if (count > 0) {
    return (
      <span
        data-roster-unread-count
        data-mention={mentions > 0 ? "true" : undefined}
        className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-caption font-semibold tabular-nums ${
          mentions > 0
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        {unreadBadgeText(count)}
        <span className="sr-only">
          <Trans> (unread)</Trans>
        </span>
      </span>
    );
  }
  return (
    <>
      <span
        aria-hidden="true"
        data-roster-unread-dot
        className="inline-block size-2 shrink-0 rounded-full bg-unread"
      />
      <span className="sr-only">
        <Trans> (unread)</Trans>
      </span>
    </>
  );
}
