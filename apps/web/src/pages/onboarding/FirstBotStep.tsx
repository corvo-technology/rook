import type { AgentCatalogLocale, ApprovalMode } from "@corvo/contracts";
import { storedBotApprovalMode } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { AutonomyPicker } from "../../components/AutonomyPicker";
import { ensureFirstBot } from "../../lib/first-bot";
import { rpc } from "../../lib/rpc";

type Setup = { botId: string; name: string; defaultMode: ApprovalMode; checkerAvailable: boolean };

/**
 * The Chief is the first agent and adds the others in chat, so this step makes sure it exists and
 * asks how much it does on its own. If the default cannot be read the step moves on: the Chief
 * follows the default and the question stays in its settings.
 */
export function FirstBotStep({
  locale,
  onReady,
}: {
  locale: AgentCatalogLocale;
  onReady: (chiefId: string) => void;
}) {
  const { t } = useLingui();
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [choice, setChoice] = useState<ApprovalMode>("ask");
  const [pending, setPending] = useState(false);
  const continuing = useRef(false);

  // `attempt` re-runs the call on retry; `onReady` changes every render, so it is left out.
  useEffect(() => {
    setFailed(false);
    let live = true;
    void (async () => {
      let chiefId: string;
      try {
        chiefId = (await ensureFirstBot(locale)).id;
      } catch {
        if (live) setFailed(true);
        return;
      }
      try {
        const [defaults, bot] = await Promise.all([
          rpc.autoReview.get({}),
          rpc.bots.get({ botId: chiefId }),
        ]);
        if (!live) return;
        setChoice(defaults.mode);
        setSetup({
          botId: chiefId,
          name: bot.name,
          defaultMode: defaults.mode,
          checkerAvailable: defaults.checkerAvailable,
        });
      } catch {
        if (live) onReady(chiefId);
      }
    })();
    return () => {
      live = false;
    };
  }, [locale, attempt]);

  async function next() {
    if (!setup || continuing.current) return;
    continuing.current = true;
    setPending(true);
    setSaveFailed(false);
    try {
      const approvalMode = storedBotApprovalMode(choice, setup.defaultMode);
      if (approvalMode !== null) await rpc.bots.update({ botId: setup.botId, approvalMode });
      onReady(setup.botId);
    } catch {
      continuing.current = false;
      setPending(false);
      setSaveFailed(true);
    }
  }

  if (failed || saveFailed) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
        <span>{t`Could not set up your bots`}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (failed ? setAttempt((count) => count + 1) : void next())}
        >
          {t`Try again`}
        </Button>
      </div>
    );
  }
  if (!setup) return null;
  return (
    <div className="flex flex-col gap-6">
      <AutonomyPicker
        name={setup.name}
        value={choice}
        checkerAvailable={setup.checkerAvailable}
        disabled={pending}
        onChange={setChoice}
      />
      <Button size="lg" disabled={pending} onClick={() => void next()}>
        <Trans>Continue</Trans>
      </Button>
    </div>
  );
}
