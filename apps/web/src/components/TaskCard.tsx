import { Trans } from "@lingui/react/macro";

/** A task an agent put on the board: its number and what it is for, on one line. */
export function TaskCard({ taskRef, title }: { taskRef: string; title: string }) {
  return (
    <div
      data-testid="task-card"
      className="flex w-fit max-w-full gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground"
    >
      <span className="min-w-0 truncate" dir="auto">
        <Trans>
          Created task <b className="font-semibold text-foreground">{taskRef}</b> · {title}
        </Trans>
      </span>
    </div>
  );
}
