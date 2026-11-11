import type { AgentCatalogLocale, OnboardingPicks } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { FirstBot } from "../../lib/first-bot";
import { ensureFirstBot } from "../../lib/first-bot";

/**
 * The Chief is the first agent and adds the others in chat, so this step makes sure it exists
 * (and the agent the survey picks name) and moves on; the person picks nothing here.
 */
export function FirstBotStep({
  locale,
  picks,
  onReady,
}: {
  locale: AgentCatalogLocale;
  picks: OnboardingPicks | null;
  onReady: (result: FirstBot) => void;
}) {
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // `attempt` re-runs the call on retry; `onReady` changes every render, so it is left out.
  useEffect(() => {
    setFailed(false);
    let live = true;
    void ensureFirstBot(locale, picks ?? undefined)
      .then((result) => live && onReady(result))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [locale, attempt]);

  if (!failed) return null;
  return (
    <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
      <span>{t`Could not set up your bots`}</span>
      <Button variant="outline" size="sm" onClick={() => setAttempt((count) => count + 1)}>
        {t`Try again`}
      </Button>
    </div>
  );
}
