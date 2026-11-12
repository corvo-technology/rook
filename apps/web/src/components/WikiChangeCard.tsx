import type { WikiChange } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { Trans } from "@lingui/react/macro";
import { BuiCard } from "./ai/primitives";

export type WikiChangeCardProps = {
  change: Pick<
    WikiChange,
    | "state"
    | "reason"
    | "sourceTitle"
    | "pages"
    | "edits"
    | "canSeeSource"
    | "sourceText"
    | "review"
  >;
  /** An answer is on its way, so the buttons wait. */
  busy?: boolean;
  onDecide: (decision: "apply" | "refuse" | "undo") => void;
  onOpenPage: (title: string) => void;
  /** Asks for a change that hit a page that moved to be written again; absent where it cannot. */
  onRetry?: () => void;
};

function State({ state }: { state: WikiChange["state"] }) {
  switch (state) {
    case "pending":
      return <Trans>Waiting for approval</Trans>;
    case "applied":
      return <Trans>Added to the wiki</Trans>;
    case "refused":
      return <Trans>Refused</Trans>;
    case "undone":
      return <Trans>Undone</Trans>;
    case "conflict":
      return <Trans>A page changed since</Trans>;
  }
}

/**
 * What the wiki kept, or is waiting to keep, from a conversation: the pages it touches, why, and the
 * one thing a person can do about it now. The quoted source is only there for whom it was said to.
 */
export function WikiChangeCard({
  change,
  busy,
  onDecide,
  onOpenPage,
  onRetry,
}: WikiChangeCardProps) {
  return (
    <BuiCard
      className="flex w-full max-w-md flex-col gap-2 px-4 py-3"
      data-testid="wiki-change"
      data-state={change.state}
    >
      {change.review && change.sourceTitle ? (
        <p className="text-sm font-medium">{change.sourceTitle}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          <State state={change.state} />
        </p>
      )}
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {change.pages.map((page) => (
          <li key={page.title}>
            <Button
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => onOpenPage(page.title)}
            >
              {page.title}
            </Button>
          </li>
        ))}
      </ul>
      {change.state === "pending" && change.edits.length ? (
        <div
          className="flex max-h-56 flex-col gap-1.5 overflow-y-auto"
          data-testid="wiki-change-edits"
        >
          {change.edits.map((edit, index) => (
            <div key={index} className="rounded-md bg-muted px-2.5 py-1.5 text-sm">
              <span className="block text-xs text-muted-foreground">
                {edit.section ? `${edit.title} · ${edit.section}` : edit.title}
              </span>
              {edit.removed ? (
                <p className="whitespace-pre-wrap text-muted-foreground line-through" dir="auto">
                  {edit.removed}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap" dir="auto">
                {edit.added}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {change.reason ? <p className="text-sm">{change.reason}</p> : null}
      {change.canSeeSource && change.sourceText ? (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">
            <Trans>Source</Trans>
          </summary>
          <p className="mt-1 whitespace-pre-wrap" dir="auto">
            {change.sourceText}
          </p>
        </details>
      ) : null}
      {change.state === "pending" ? (
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={() => onDecide("apply")}>
            <Trans>Approve</Trans>
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("refuse")}>
            <Trans>Refuse</Trans>
          </Button>
        </div>
      ) : null}
      {change.state === "conflict" && onRetry ? (
        <div className="pt-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRetry}>
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : null}
      {change.state === "applied" ? (
        <div className="pt-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("undo")}>
            <Trans>Undo</Trans>
          </Button>
        </div>
      ) : null}
    </BuiCard>
  );
}
