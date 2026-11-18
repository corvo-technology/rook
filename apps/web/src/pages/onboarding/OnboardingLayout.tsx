import { mascotHex } from "@corvo/core";
import { BotAvatar, Button, Kbd, Progress } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { stepsLeft } from "../../lib/onboarding-rail";
import type { OnboardingStepId } from "../../lib/onboarding-steps";
import { progress } from "../../lib/onboarding-steps";

export type OnboardingSidebarStep = { id: OnboardingStepId; label: string; detail?: string };

/** Marks the button that Enter presses when nothing else holds the key. */
export const ONBOARDING_CONTINUE_ATTRIBUTE = "data-onboarding-continue";

const KEY_HOLDERS =
  "input, textarea, select, button, a, [contenteditable='true'], [role='combobox']";

/**
 * The first run's frame: the steps and what was answered on the left with the Chief's line under
 * them, the step in the middle, and a live miniature of the workspace on the right. Enter presses
 * the step's Continue when nothing else holds the key; the page below a wide screen shows only the
 * current step.
 */
export function OnboardingLayout({
  steps,
  current,
  done,
  narration,
  preview,
  onBack,
  onSkip,
  children,
}: {
  steps: readonly OnboardingSidebarStep[];
  current: OnboardingStepId;
  done: ReadonlySet<OnboardingStepId>;
  /** The Chief's line for this step. */
  narration?: string;
  preview?: ReactNode;
  onBack?: () => void;
  onSkip?: () => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const ids = steps.map((step) => step.id);
  const { percent } = progress(ids, done);
  const left = stepsLeft(ids, done);
  const currentLabel = steps.find((step) => step.id === current)?.label;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      const target = event.target as Element | null;
      if (target?.closest?.(KEY_HOLDERS)) return;
      const next = document.querySelector<HTMLButtonElement>(`[${ONBOARDING_CONTINUE_ATTRIBUTE}]`);
      if (next && !next.disabled) {
        event.preventDefault();
        next.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div data-corvo-surface="onboarding" className="flex min-h-svh bg-background text-foreground">
      <aside
        data-testid="onboarding-rail"
        className="hidden w-72 shrink-0 flex-col justify-between border-e border-border bg-card/50 p-6 md:flex"
      >
        <div>
          <p className="text-sm font-medium">
            {left === 1 ? t`1 step left` : t`${left} steps left`}
          </p>
          <Progress value={percent} aria-label={t`Progress`} className="mt-3" />
          <ol className="mt-6 flex flex-col gap-4">
            {steps.map((step) => {
              const isDone = done.has(step.id);
              const isCurrent = step.id === current;
              return (
                <li
                  key={step.id}
                  aria-current={isCurrent ? "step" : undefined}
                  className="flex min-w-0 items-start gap-3 text-sm"
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                      isDone
                        ? "border-foreground bg-foreground text-background"
                        : isCurrent
                          ? "border-foreground"
                          : "border-border"
                    }`}
                  >
                    {isDone ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block truncate ${isCurrent ? "font-medium" : "text-muted-foreground"}`}
                    >
                      {step.label}
                      {isDone ? <span className="sr-only"> {t`Completed`}</span> : null}
                    </span>
                    {step.detail && isDone ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {step.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        {narration ? (
          <div data-testid="onboarding-narration" className="flex items-end gap-2">
            <BotAvatar color={mascotHex("mint")} identity="corvo" size={36} live />
            <p
              key={current}
              className="rounded-2xl rounded-bl-sm border border-border bg-background px-3 py-2 text-sm"
            >
              {narration}
            </p>
          </div>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="px-6 pt-6 md:hidden">
          <Progress value={percent} aria-label={t`Progress`} />
          <p className="mt-3 text-sm font-medium">{currentLabel}</p>
        </header>
        <main className="flex flex-1 items-center px-6 py-10">
          <div className="mx-auto w-full max-w-md">
            {onBack ? (
              <Button variant="ghost" size="sm" className="-ml-2 mb-6" onClick={onBack}>
                <ChevronLeft aria-hidden />
                {t`Back`}
              </Button>
            ) : null}
            {children}
            {onSkip ? (
              <Button variant="ghost" className="mt-2 w-full" onClick={onSkip}>
                {t`Skip`}
              </Button>
            ) : null}
            {narration ? (
              <p className="mt-8 text-center text-sm text-muted-foreground md:hidden">
                {narration}
              </p>
            ) : null}
          </div>
        </main>
      </div>
      {preview ? (
        <aside
          data-testid="onboarding-preview"
          aria-hidden="true"
          className="hidden w-[22rem] shrink-0 items-center justify-center border-s border-border bg-muted/40 p-8 xl:flex"
        >
          {preview}
        </aside>
      ) : null}
    </div>
  );
}

/** A primary button with the Enter hint; the hint is left out of its name. */
export function ContinueButton({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="submit"
      {...{ [ONBOARDING_CONTINUE_ATTRIBUTE]: "" }}
      className={className}
      {...props}
    >
      {children}
      <Kbd
        aria-hidden
        className="ms-1 hidden bg-primary-foreground/20 text-primary-foreground sm:inline-flex"
      >
        ↵
      </Kbd>
    </Button>
  );
}
