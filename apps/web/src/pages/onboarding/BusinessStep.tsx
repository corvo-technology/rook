import type { BusinessAnswer, BusinessKind } from "@corvo/contracts";
import { BUSINESS_KINDS, BUSINESS_SUMMARY_MAX_LENGTH } from "@corvo/contracts";
import { Button, Input } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { useBusinessLabels } from "./labels";
import { ContinueButton } from "./OnboardingLayout";

/**
 * What the workspace does: a kind and, if the person wants, a sentence. The answer becomes shared
 * knowledge every agent reads. Continuing with nothing says nothing and saves nothing.
 */
export function BusinessStep({
  initial,
  onChange,
  onDone,
}: {
  initial: BusinessAnswer | null;
  onChange?: (kind: BusinessKind | null) => void;
  onDone: (answer: BusinessAnswer | null) => void;
}) {
  const { t } = useLingui();
  const labels = useBusinessLabels();
  const sentenceId = useId();
  const [kind, setKind] = useState<BusinessKind | null>(initial?.kind ?? null);
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function submit() {
    if (started.current) return;
    const text = summary.trim();
    if (!kind && !text) {
      onDone(null);
      return;
    }
    const answer: BusinessAnswer = { kind: kind ?? "other", summary: text };
    started.current = true;
    setPending(true);
    setError(null);
    try {
      await rpc.onboarding.saveBusiness(answer);
      onDone(answer);
    } catch (err) {
      started.current = false;
      setPending(false);
      setError(errorText(err, t`Could not save`));
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1 className="text-[32px] font-medium text-foreground">{t`What do you do?`}</h1>
      <div className="mt-6 flex flex-wrap gap-2">
        {BUSINESS_KINDS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={kind === option ? "secondary" : "outline"}
            aria-pressed={kind === option}
            disabled={pending}
            onClick={() => {
              const next = kind === option ? null : option;
              setKind(next);
              onChange?.(next);
            }}
          >
            {labels[option]}
          </Button>
        ))}
      </div>
      <label htmlFor={sentenceId} className="mt-6 block text-sm text-muted-foreground">
        {t`In one sentence`}
      </label>
      <Input
        id={sentenceId}
        className="mt-2"
        maxLength={BUSINESS_SUMMARY_MAX_LENGTH}
        value={summary}
        disabled={pending}
        onChange={(event) => setSummary(event.target.value)}
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ContinueButton className="mt-8 w-full" disabled={pending}>
        {t`Continue`}
      </ContinueButton>
    </form>
  );
}
