import type { ApprovalMode } from "@corvo/contracts";
import type { ApprovalSummary } from "@corvo/core";
import { approvalModeSummary } from "@corvo/core";
import { Button, RadioGroup, RadioGroupItem } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";

/** What still asks at each answer, keyed by the summary the gate yields. */
function useSummaryLines(): Record<ApprovalSummary, string> {
  const { t } = useLingui();
  return {
    every_change: t`Still asks before anything that changes something, and before opening a site you didn't mention.`,
    reviewed: t`Still asks when a second model finds it outside your request, and before security changes.`,
    steered_only: t`Still asks before a security change after it read outside content. Blocked actions stay blocked.`,
  };
}

/** Confirms choosing Never ask in place, which stops every question except the ones the gate keeps. */
export function NeverAskConfirm({
  name,
  open,
  onConfirm,
  onCancel,
}: {
  name?: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const lines = useSummaryLines();
  if (!open) return null;
  const question = name ? t`Let ${name} act without asking?` : t`Let bots act without asking?`;
  return (
    <div
      role="alert"
      aria-label={question}
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <p className="text-sm font-medium break-words text-foreground">{question}</p>
      <p className="text-[13px] text-muted-foreground">{lines.steered_only}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          <Trans>Stop asking</Trans>
        </Button>
      </div>
    </div>
  );
}

/**
 * How much a bot does on its own, as one question with up to three answers. Each answer is an
 * approval mode; the line below says what still asks, as the gate itself decides it.
 */
export function AutonomyPicker({
  name,
  value,
  checkerAvailable,
  disabled,
  onChange,
}: {
  name?: string;
  value: ApprovalMode;
  checkerAvailable: boolean;
  disabled?: boolean;
  onChange: (mode: ApprovalMode) => void;
}) {
  const { t } = useLingui();
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const lines = useSummaryLines();
  const options: Array<{ mode: ApprovalMode; label: string }> = [
    { mode: "ask", label: t`Asks before any change` },
    // Normal needs an approval model; it stays listed while chosen so the choice stays visible.
    ...(checkerAvailable || value === "auto"
      ? [{ mode: "auto" as const, label: t`Does what fits your request` }]
      : []),
    { mode: "never", label: t`Does everything without asking` },
  ];

  function choose(next: ApprovalMode) {
    if (next === value) return;
    if (next === "never") return setConfirming(true);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {name ? (
        <p id={questionId} className="text-sm font-medium text-foreground">
          {t`How much does ${name} do on its own?`}
        </p>
      ) : null}
      <RadioGroup
        aria-labelledby={name ? questionId : undefined}
        value={value}
        disabled={disabled}
        onValueChange={(next) => choose(next as ApprovalMode)}
      >
        {options.map(({ mode, label }) => (
          <label
            key={mode}
            htmlFor={`${questionId}-${mode}`}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-foreground"
          >
            {label}
            <RadioGroupItem id={`${questionId}-${mode}`} value={mode} />
          </label>
        ))}
      </RadioGroup>
      <p aria-live="polite" className="text-[13px] text-muted-foreground">
        {lines[approvalModeSummary({ mode: value, checkerConfigured: checkerAvailable })]}
      </p>
      {value === "auto" && !checkerAvailable ? (
        <p className="text-[13px] text-muted-foreground">
          <Trans>Add a model in Settings to use this.</Trans>
        </p>
      ) : null}
      <NeverAskConfirm
        name={name}
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onChange("never");
        }}
      />
    </div>
  );
}
