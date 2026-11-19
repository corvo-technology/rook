import { Button, Skeleton } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { errorText } from "../../lib/user-error";

/** A failed load: the coded message of the error and a way to try again. */
export function PartnerError({
  error,
  onRetry,
  message,
}: {
  error: unknown;
  onRetry?: () => void;
  /** Overrides the text read from the error, for refusals with a reason of their own. */
  message?: string;
}) {
  const { t } = useLingui();
  return (
    <div
      role="alert"
      data-testid="partner-error"
      className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm text-destructive"
    >
      <span className="min-w-0">{message ?? errorText(error)}</span>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t`Try again`}
        </Button>
      ) : null}
    </div>
  );
}

export function PartnerLoading() {
  return (
    <div className="space-y-3" data-testid="partner-loading">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/** One of the figures at the top of a screen. */
export function Kpi({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-caption text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-light tracking-tight tabular-nums">{value}</div>
      {detail ? <div className="mt-0.5 text-meta text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  "data-testid": testId,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <section data-testid={testId} className="rounded-xl border border-border bg-card">
      {title || action ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-[14px] font-medium">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Runs one write at a time and keeps its failure for the screen to show. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}

/** Opens an address that is fetched first without the browser blocking it as a pop-up. */
export async function openInNewWindow(resolve: () => Promise<string>): Promise<void> {
  const popup = window.open("", "_blank");
  try {
    const url = await resolve();
    if (popup) {
      popup.opener = null;
      popup.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}
