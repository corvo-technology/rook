import type { WorkspaceModel } from "@corvo/contracts";
import { writeSaved } from "@corvo/core/query";
import { Switch } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

/**
 * The owner lends their models to the space's members; a member, once they are lent, may use
 * their own instead. Hidden when there is nothing to choose, such as a member before any lending.
 */
export function WorkspaceModelRow() {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const state = useQuery(queries.models.workspaceModel.queryOptions());
  const current = state.data;
  if (!current || (!current.isOwner && !current.shared)) return null;

  const checked = current.isOwner ? current.shared : current.useOwn;
  const label = current.isOwner ? t`Share my models with members` : t`Use my own models`;

  async function change(next: boolean) {
    setError(null);
    try {
      const saved: WorkspaceModel = current?.isOwner
        ? await rpc.models.setWorkspaceModel({ shared: next })
        : await rpc.models.setUseOwnModel({ useOwn: next });
      await writeSaved(queryClient, queries.models.workspaceModel.queryKey(), () => saved);
      // Which connections serve a run changes with it.
      void queryClient.invalidateQueries({ queryKey: queries.models.key() });
      void queryClient.invalidateQueries({ queryKey: queries.me.key() });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="space-y-2" data-testid="workspace-model">
      <SettingsGroup>
        <SettingsRow
          label={<label htmlFor={id}>{label}</label>}
          control={
            <Switch id={id} checked={checked} onCheckedChange={(next) => void change(next)} />
          }
        />
      </SettingsGroup>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
