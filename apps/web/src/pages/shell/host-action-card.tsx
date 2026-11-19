import type { MessageBlock } from "@corvo/contracts";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { BuiCard, SuccessPop } from "../../components/ai/primitives";
import { hostAsk, rememberHostResult, runHostAction } from "../../lib/embed-host";
import { rpc } from "../../lib/rpc";

type HostActionBlock = Extract<MessageBlock, { kind: "host_action" }>;

/**
 * An action the partner's page can carry out, proposed by the agent. Nothing happens until the
 * person confirms; then the page does it and says how it went, and the agent hears the result.
 */
export function HostActionCard({
  botId,
  messageId,
  block,
}: {
  botId: string;
  messageId: string;
  block: HostActionBlock;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  // Shown at once; the stored card catches up when the event stream delivers it.
  const [decided, setDecided] = useState<"done" | "denied" | "failed" | null>(null);
  const status = block.status === "pending" ? (decided ?? "pending") : block.status;

  async function decide(outcome: "done" | "denied" | "failed", result?: string) {
    setDecided(outcome);
    rememberHostResult({ name: block.name, outcome, result });
    await rpc.threads
      .resolveHostAction({
        botId,
        messageId,
        actionId: block.actionId,
        actionName: block.name,
        outcome,
      })
      .catch(() => undefined);
  }

  async function confirm() {
    setBusy(true);
    const answer = await runHostAction({
      actionId: block.actionId,
      name: block.name,
      params: block.params,
    });
    await decide(answer.outcome, answer.result);
    // The agent hears how it went as the person's next message, so the conversation goes on.
    hostAsk(answer.outcome === "done" ? t`Done` : t`That didn't work`);
    setBusy(false);
  }

  return (
    <BuiCard
      role="group"
      aria-label={block.label}
      data-testid="host-action-card"
      className="w-full max-w-[440px] px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[14px] font-medium text-foreground">
          {block.label}
        </span>
        {status === "pending" ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decide("denied")}>
              {t`Not now`}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void confirm()}>
              {t`Confirm`}
            </Button>
          </>
        ) : status === "done" ? (
          <SuccessPop label={t`Done`} />
        ) : status === "failed" ? (
          <span className="text-[13px] text-destructive">{t`That didn't work`}</span>
        ) : null}
      </div>
    </BuiCard>
  );
}
