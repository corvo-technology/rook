import { Input } from "@corvo/ui-web";
import type { ComponentProps } from "react";

/** A short typed number; the value stays text until it is used, so half-typed input is kept. */
export function NumberInput({
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & { label: string }) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={`h-8 w-24 tabular-nums ${className ?? ""}`}
      {...props}
    />
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "negative";
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="text-meta uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1.5 text-2xl font-light tabular-nums ${tone === "negative" ? "text-destructive" : ""}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** First day of the current month as `YYYY-MM`. */
export function currentPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
