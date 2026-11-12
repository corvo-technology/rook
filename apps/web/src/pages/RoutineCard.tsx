import type { RoutineOccurrence } from "@corvo/contracts";
import { Button, SidePanel } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Play } from "lucide-react";
import { useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { RoutineRunDetail } from "./RoutineRunDetail";

/** One routine from the calendar: when, by whom, and a way to run it now or go to its agent. */
export function RoutineCard({
  item,
  time,
  onOpenAgent,
  onRan,
  onClose,
}: {
  item: RoutineOccurrence;
  /** The entry's day and time, already worded for the viewer. */
  time: string;
  onOpenAgent: () => void;
  onRan: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await rpc.routines.testRun({ routineId: item.routineId });
      onRan();
    } catch (reason) {
      setError(errorText(reason, t`Could not run the routine`));
      setRunning(false);
    }
  }

  const stateLabel = {
    done: t`Done`,
    failed: t`Failed`,
    running: t`Running`,
    upcoming: t`Upcoming`,
  }[item.state];
  const stateTone = {
    done: "text-success",
    failed: "text-destructive",
    running: "text-warning",
    upcoming: "text-muted-foreground",
  }[item.state];

  return (
    <SidePanel
      open
      onClose={running ? () => undefined : onClose}
      title={item.name}
      closeLabel={t`Close`}
      data-testid="routine-card"
      footer={
        <>
          <Button variant="outline" disabled={running} onClick={onOpenAgent}>
            <Trans>Open agent</Trans>
          </Button>
          <Button disabled={running} onClick={() => void runNow()}>
            <Play />
            {running ? <Trans>Running…</Trans> : <Trans>Run now</Trans>}
          </Button>
        </>
      }
    >
      <p className={`text-[13.5px] font-medium ${stateTone}`}>{stateLabel}</p>
      <p className="text-[13.5px] text-muted-foreground">
        {item.botName} · {time}
      </p>
      {item.runId ? (
        <RoutineRunDetail routineId={item.routineId} runId={item.runId} at={item.at} />
      ) : null}
      {error ? (
        <p role="alert" className="text-[13.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </SidePanel>
  );
}
