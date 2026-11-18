import type { Bot, RunActivityRow } from "@corvo/contracts";
import { BotAvatar, Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router-dom";
import { clock, runStart, stepText } from "../../lib/home-live";
import { useNow, useTypewriter } from "./hooks";

function Row({ run, color, now }: { run: RunActivityRow; color: string; now: number }) {
  const navigate = useNavigate();
  const { t } = useLingui();
  const step = useTypewriter(stepText(run) || t`Working`);
  return (
    <li className="rk-home-row-in">
      <button
        type="button"
        data-testid="home-working-row"
        className="rk-home-lift flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-start outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => navigate(run.groupId ? `/app/g/${run.groupId}` : `/app/${run.botId}`)}
      >
        <span className="rk-home-ring relative grid size-9 shrink-0 place-items-center">
          <BotAvatar color={color} identity={run.botId} size={30} status="running" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{run.botName}</span>
          <span className="rk-home-caret truncate font-mono text-xs text-muted-foreground">
            {step}
          </span>
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {clock(now - runStart(run))}
        </span>
      </button>
    </li>
  );
}

/** The body of the "Working now" card: live rows, or the team resting with a way to give work. */
export function WorkingFeed({
  runs,
  bots,
  onGiveWork,
}: {
  runs: readonly RunActivityRow[];
  bots: readonly Bot[];
  onGiveWork: () => void;
}) {
  const { t } = useLingui();
  const now = useNow();
  if (runs.length > 0) {
    return (
      <ul className="flex flex-col pb-10">
        {runs.map((run) => (
          <Row
            key={run.runId}
            run={run}
            now={now}
            color={bots.find((bot) => bot.id === run.botId)?.color ?? ""}
          />
        ))}
      </ul>
    );
  }
  return (
    <div data-testid="home-idle" className="flex flex-1 flex-col items-start gap-4">
      <p className="text-sm text-muted-foreground">{t`Nothing running now.`}</p>
      <ul className="flex -space-x-2">
        {bots.slice(0, 5).map((bot) => (
          <li key={bot.id} className="rounded-full ring-2 ring-muted">
            <BotAvatar color={bot.color} identity={bot.id} size={32} status="asleep" />
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={onGiveWork}>
        {t`Give work`}
      </Button>
    </div>
  );
}
