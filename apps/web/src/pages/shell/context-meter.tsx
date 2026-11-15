import { Button, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { contextMeterView, formatTokens } from "../../lib/context-meter";
import { useSpaceQueries } from "../../lib/query";

const RING = 18;
const STROKE = 2.5;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How much of the model's reading window the chat uses, and a way to summarize the older part
 * when it is getting full. It is hidden until the bot has answered once, because there is
 * nothing to measure before that.
 */
export function ContextMeter({ botId, running }: { botId: string; running: boolean }) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const context = useQuery(queries.threads.context.queryOptions({ input: { botId } }));
  const compress = useMutation(queries.threads.compress.mutationOptions());
  const [compressing, setCompressing] = useState(false);
  const wasRunning = useRef(running);

  // A turn that just ended changed what the chat holds: measure again, and let it be compressed again.
  useEffect(() => {
    if (wasRunning.current && !running) {
      setCompressing(false);
      void context.refetch();
    }
    wasRunning.current = running;
  }, [running, context.refetch]);

  useEffect(() => setCompressing(false), [botId]);

  const usedTokens = context.data?.usedTokens;
  if (usedTokens === null || usedTokens === undefined) return null;
  const windowTokens = context.data?.windowTokens ?? null;
  const { percent, warn } = contextMeterView(usedTokens, windowTokens);
  const used = formatTokens(usedTokens, i18n.locale);
  const windowLabel = formatTokens(windowTokens ?? 0, i18n.locale);
  const summary =
    percent === null ? t`${used} tokens` : t`${percent}% used · ${used} of ${windowLabel} tokens`;

  return (
    <Popover>
      <IconTooltip label={t`Context`}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              data-testid="context-meter"
              aria-label={t`Context`}
              className="app-no-drag"
            />
          }
        >
          <svg
            width={RING}
            height={RING}
            viewBox={`0 0 ${RING} ${RING}`}
            aria-hidden="true"
            className={warn ? "text-warning" : "text-muted-foreground"}
          >
            <circle
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={STROKE}
            />
            <circle
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - (percent ?? 0) / 100)}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </svg>
        </PopoverTrigger>
      </IconTooltip>
      <PopoverContent align="end" className="w-64 gap-3 text-sm">
        <p data-testid="context-summary">{summary}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={compressing || compress.isPending}
          onClick={() => {
            setCompressing(true);
            compress.mutate({ botId }, { onError: () => setCompressing(false) });
          }}
        >
          {compressing ? t`Compressing…` : t`Compress context`}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
