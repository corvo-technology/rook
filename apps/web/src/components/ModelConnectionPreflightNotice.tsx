import type { ModelProblemAction } from "@corvo/core";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type { ModelPreflightFailure } from "../lib/model-connection-preflight";
import { SuccessPop } from "./ai/primitives";
import { ModelProblemNotice } from "./ModelProblemNotice";

export function ModelPreflightFeedback({
  success,
  failure,
  onRetry,
  onAction,
}: {
  success: string | null;
  failure: ModelPreflightFailure | null;
  onRetry?: () => void;
  /** The actions this screen can perform; any other action is not offered. */
  onAction?: Partial<Record<ModelProblemAction, () => void>>;
}) {
  if (success) {
    return (
      <div className="mt-2" role="status">
        <SuccessPop label={success} />
      </div>
    );
  }
  if (!failure) return null;
  if (failure.outcome === "provider") {
    return (
      <ModelProblemNotice
        className="mt-2"
        problem={
          failure.problem.action && onAction?.[failure.problem.action]
            ? failure.problem
            : { ...failure.problem, action: undefined }
        }
        onRetry={onRetry}
        onAction={(action) => onAction?.[action]?.()}
      />
    );
  }
  return (
    <div className="mt-2 space-y-1 text-[13px]" role="alert">
      <p className="text-destructive">{failure.message}</p>
      <p className="text-muted-foreground">{failure.nextAction}</p>
    </div>
  );
}

export function modelPreflightTestingLabel(
  testing: boolean,
  kind: "api-key" | "sign-in",
): ReactNode {
  if (testing) return <Trans>Testing…</Trans>;
  return kind === "api-key" ? <Trans>Test API key</Trans> : <Trans>Test connection</Trans>;
}
