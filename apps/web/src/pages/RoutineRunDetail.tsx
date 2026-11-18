import type { RoutineRun } from "@corvo/contracts";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../lib/query";
import { formatRunDuration } from "../lib/routine-calendar";
import { runFailureLines } from "../lib/run-error-copy";

/** What a finished run did: how long it took, and why it stopped when it did not work. */
export function RunSummary({ run }: { run: RoutineRun }) {
  const { i18n, t } = useLingui();
  const locale = i18n.locale || "en";
  const took =
    run.startedAt && run.completedAt
      ? formatRunDuration(Date.parse(run.completedAt) - Date.parse(run.startedAt), locale)
      : null;
  const failure = run.error ? runFailureLines(run.error, run.errorInfo, locale) : null;
  return (
    <div className="space-y-2 text-[13.5px]">
      {took ? (
        <p className="text-muted-foreground">
          <Trans>Took {took}</Trans>
        </p>
      ) : null}
      {run.status === "failed" && run.error && failure ? (
        <div className="text-destructive">
          <p>{failure.title}</p>
          {failure.line ? <p className="text-muted-foreground">{failure.line}</p> : null}
          <details key={run.error} className="mt-1 text-xs">
            <summary className="w-fit cursor-pointer">{t`Details`}</summary>
            <pre className="mt-2 break-words whitespace-pre-wrap">{failure.details}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Looks the run up in its routine's history. The history only lists the owner's routines, so for
 * anyone else's it says nothing rather than failing the card.
 */
export function RoutineRunDetail({
  routineId,
  runId,
  at,
}: {
  routineId: string;
  runId: string;
  at: string;
}) {
  const queries = useSpaceQueries();
  // Asking for runs up to a moment after this one puts it first in the page.
  const before = { id: runId, createdAt: new Date(Date.parse(at) + 1).toISOString() };
  const history = useQuery(
    queries.routines.history.queryOptions({ input: { routineId, before, limit: 3 } }),
  );
  const run = history.data?.runs.find((candidate) => candidate.id === runId);
  return run ? <RunSummary run={run} /> : null;
}
