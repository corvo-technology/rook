import type { RunErrorInfo } from "@corvo/contracts";
import type { ModelProblemOptions } from "@corvo/core";
import { Button, InlineConfirm } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { isEmbedded } from "../lib/embed";
import type { RunErrorAction } from "../lib/run-error-copy";
import { describeEmbeddedSetupError, describeRunError } from "../lib/run-error-copy";
import { errorText } from "../lib/user-error";
import { ComputerLimitAction } from "./ExtraComputers";

export type RunErrorHandlers = {
  onRetry?: () => void;
  retrying?: boolean;
  /** Clear the computer's own temporary files. Resolves when there is more room. */
  onFreeSpace?: () => Promise<void>;
  /** Rebuild the computer from its last save. Resolves once the rebuild is queued. */
  onRecover?: () => Promise<void>;
  onOpenUsage?: () => void;
  onAdjustLimit?: () => void;
  onResume?: () => void;
  onChangeModel?: () => void;
  onConnect?: (action: "connect" | "sign-in" | "replace-key") => void;
};

/**
 * A failed run: what happened in one line, one line of why or what to do, the actions that fit,
 * and the technical code collapsed. Worded here in the viewer's language from the saved code.
 */
export function RunErrorCard({
  info,
  raw,
  authKind,
  ...handlers
}: {
  info: RunErrorInfo;
  /** The English text the run saved beside its code. */
  raw: string;
  authKind?: ModelProblemOptions["authKind"];
} & RunErrorHandlers) {
  const { t } = useLingui();
  const view =
    (isEmbedded() ? describeEmbeddedSetupError(info) : null) ??
    describeRunError(info, raw, authKind);
  const [pending, setPending] = useState<"free-space" | "recover" | null>(null);
  // The action that worked, so the card can offer to run the failed turn again.
  const [done, setDone] = useState<"free-space" | "recover" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function label(action: RunErrorAction): string {
    switch (action) {
      case "retry":
        return t`Try again`;
      case "recover":
        return t`Recover computer`;
      case "free-space":
        return t`Free up space`;
      case "open-usage":
        return t`Open usage`;
      case "adjust-limit":
        return t`Adjust limit`;
      case "resume":
        return t`Resume`;
      case "change-model":
        return t`Change model`;
      case "connect":
        return t`Connect a model`;
      case "sign-in":
        return t`Sign in again`;
      case "replace-key":
        return t`Replace key`;
    }
  }

  async function run(action: "free-space" | "recover") {
    const handler = action === "free-space" ? handlers.onFreeSpace : handlers.onRecover;
    if (!handler) return;
    setPending(action);
    setFailure(null);
    try {
      await handler();
      setDone(action);
    } catch (error) {
      setFailure(
        errorText(
          error,
          action === "free-space" ? t`Couldn't free up space` : t`Could not update computer`,
        ),
      );
    } finally {
      setPending(null);
    }
  }

  const line =
    done === "free-space"
      ? t`Space freed up.`
      : done === "recover"
        ? t`Recovery started.`
        : view.line;
  const actions = view.actions.filter((action) => action !== done && available(action, handlers));
  // After a fix that worked, running the turn again is the next step.
  const retry = done !== null && handlers.onRetry && !actions.includes("retry");
  const ordered: RunErrorAction[] = retry ? ["retry", ...actions] : actions;

  return (
    <div
      role="alert"
      data-testid="run-error-card"
      data-code={info.code}
      className={`rounded-[14px] border px-4 py-3 text-[13px] ${
        view.tone === "warning"
          ? "border-warning/40 bg-warning/10"
          : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <p className="font-medium text-foreground">{view.title}</p>
      <p className="mt-0.5 text-muted-foreground">{failure ?? line}</p>
      {ordered.length ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {ordered.map((action, index) => {
            const primary = done !== null && action === "retry" && index === 0;
            const common = { size: "sm", variant: primary ? "default" : "outline" } as const;
            if (action === "recover") {
              return (
                <InlineConfirm
                  key={action}
                  {...common}
                  data-testid="run-error-recover"
                  disabled={pending !== null}
                  confirmLabel={t`Confirm recover?`}
                  onConfirm={() => void run("recover")}
                >
                  {t`Recover computer`}
                </InlineConfirm>
              );
            }
            return (
              <Button
                key={action}
                type="button"
                {...common}
                data-testid={`run-error-${action}`}
                disabled={pending !== null || (action === "retry" && handlers.retrying === true)}
                onClick={() => act(action, handlers, run)}
              >
                {pending === action ? `${label(action)}…` : label(action)}
              </Button>
            );
          })}
        </div>
      ) : null}
      {info.code === "plan_computer_limit" ? (
        <div className="mt-2.5">
          <ComputerLimitAction />
        </div>
      ) : null}
      {view.details ? (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-muted-foreground">{t`Details`}</summary>
          <pre
            data-testid="run-error-details"
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground"
          >
            {view.details}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function available(action: RunErrorAction, h: RunErrorHandlers): boolean {
  switch (action) {
    case "retry":
      return Boolean(h.onRetry);
    case "recover":
      return Boolean(h.onRecover);
    case "free-space":
      return Boolean(h.onFreeSpace);
    case "open-usage":
      return Boolean(h.onOpenUsage);
    case "adjust-limit":
      return Boolean(h.onAdjustLimit);
    case "resume":
      return Boolean(h.onResume);
    case "change-model":
      return Boolean(h.onChangeModel);
    case "connect":
    case "sign-in":
    case "replace-key":
      return Boolean(h.onConnect);
  }
}

function act(
  action: RunErrorAction,
  h: RunErrorHandlers,
  run: (action: "free-space" | "recover") => Promise<void>,
) {
  switch (action) {
    case "retry":
      return h.onRetry?.();
    case "free-space":
      return void run("free-space");
    case "recover":
      return void run("recover");
    case "open-usage":
      return h.onOpenUsage?.();
    case "adjust-limit":
      return h.onAdjustLimit?.();
    case "resume":
      return h.onResume?.();
    case "change-model":
      return h.onChangeModel?.();
    case "connect":
    case "sign-in":
    case "replace-key":
      return h.onConnect?.(action);
  }
}
