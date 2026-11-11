import type { ModelProblem, ModelProblemAction } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { modelProblemActionLabel } from "../lib/model-problem";

/** One line for a failed model call, the one action that fixes it, Try again, and masked Details. */
export function ModelProblemNotice({
  problem,
  onAction,
  onRetry,
  retrying = false,
  className,
}: {
  problem: ModelProblem;
  onAction?: (action: ModelProblemAction) => void;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const action = problem.action;
  const showAction = action && onAction;
  const showRetry = problem.retry && onRetry;
  return (
    <div role="alert" className={`space-y-2 text-[13px] ${className ?? ""}`}>
      <p className="text-destructive">{problem.line}</p>
      {showAction || showRetry ? (
        <div className="flex flex-wrap gap-2">
          {showAction ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="model-problem-action"
              onClick={() => onAction(action)}
            >
              {modelProblemActionLabel(action)}
            </Button>
          ) : null}
          {showRetry ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="model-problem-retry"
              disabled={retrying}
              onClick={onRetry}
            >
              {t`Try again`}
            </Button>
          ) : null}
        </div>
      ) : null}
      {problem.details ? (
        <details>
          <summary className="w-fit cursor-pointer text-muted-foreground">{t`Details`}</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {problem.details}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
