import type { ApprovalMode } from "@corvo/contracts";
import { storedBotApprovalMode } from "@corvo/core";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { AutonomyPicker } from "./AutonomyPicker";

/**
 * Opens the agent's level choice inside a waiting approval card. It approves nothing: the card
 * still waits for its answer. A change can be undone until the card is answered.
 */
export function ChangeWhenToAsk({ botId, name }: { botId: string; name?: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // The stored choice before the first change in this card, so Undo restores it exactly.
  const [before, setBefore] = useState<{ mode: ApprovalMode | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const botQuery = useQuery({
    ...queries.bots.get.queryOptions({ input: { botId } }),
    enabled: open,
  });
  const levelQuery = useQuery({
    ...queries.autoReview.get.queryOptions({ input: {} }),
    enabled: open,
  });
  const bot = botQuery.data;
  const level = levelQuery.data;

  async function save(mode: ApprovalMode | null) {
    setSaving(true);
    setError(null);
    try {
      await rpc.bots.update({ botId, approvalMode: mode });
      await queryClient.invalidateQueries({
        queryKey: queries.bots.get.queryKey({ input: { botId } }),
      });
      await queryClient.invalidateQueries({ queryKey: queries.bots.list.queryKey() });
    } catch (err) {
      setError(errorText(err, t`Could not save`));
      return false;
    } finally {
      setSaving(false);
    }
    return true;
  }

  return (
    <div className="mt-3 space-y-2" data-testid="change-when-to-ask">
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-[13px] text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {t`Change when to ask`}
      </Button>
      {open && bot && level ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <AutonomyPicker
            name={name}
            value={bot.approvalMode ?? level.mode}
            checkerAvailable={level.checkerAvailable}
            disabled={saving}
            onChange={async (choice) => {
              const stored = storedBotApprovalMode(choice, level.mode);
              const previous = bot.approvalMode ?? null;
              if (await save(stored)) setBefore((current) => current ?? { mode: previous });
            }}
          />
          {before ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[13px]"
              disabled={saving}
              onClick={async () => {
                if (await save(before.mode)) setBefore(null);
              }}
            >
              {t`Undo`}
            </Button>
          ) : null}
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
