import { humanizeToolName } from "@corvo/core";
import { writeSaved } from "@corvo/core/query";
import { Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

/**
 * The always-allow rules kept from approval cards, each with its one-tap removal: one agent's on
 * its page, every agent's in settings. Nothing shows until a rule exists.
 */
export function AlwaysAllowedRules({ botId }: { botId?: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const input = botId ? { botId } : undefined;
  const rulesQuery = useQuery(queries.scopedApprovalRules.list.queryOptions({ input }));
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rules = rulesQuery.data ?? [];
  if (rules.length === 0) return null;

  async function remove(id: string) {
    if (removing) return;
    setRemoving(id);
    setError(null);
    try {
      await rpc.scopedApprovalRules.remove({ id });
      await writeSaved(
        queryClient,
        queries.scopedApprovalRules.list.queryKey({ input }),
        (current) => (current ?? []).filter((rule) => rule.id !== id),
      );
    } catch (err) {
      setError(errorText(err, t`Could not remove rule`));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <SettingsGroup title={t`Always allowed`} data-testid="always-allowed-rules">
      {rules.map((rule) => {
        const what = [humanizeToolName(rule.tool), rule.connection].filter(Boolean).join(" · ");
        return (
          <SettingsRow
            key={rule.id}
            label={botId ? what : `${rule.botName} · ${what}`}
            control={
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                aria-label={t`Remove ${what}`}
                disabled={removing !== null}
                onClick={() => void remove(rule.id)}
              >
                {t`Remove`}
              </Button>
            }
          />
        );
      })}
      {error ? <p className="px-4 py-2 text-[13px] text-destructive">{error}</p> : null}
    </SettingsGroup>
  );
}
