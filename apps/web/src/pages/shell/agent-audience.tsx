import type { Bot } from "@corvo/contracts";
import { Button, Switch } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

/**
 * Who may talk to the agent. Shown only to who may change it (its owner, or `manage_agents`):
 * for anyone else the read is refused and the section is not there.
 */
export function AgentAudienceSection({ bot }: { bot: Pick<Bot, "id" | "name"> }) {
  const { t } = useLingui();
  const ids = useId();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const audienceOptions = queries.bots.audience.get.queryOptions({ input: { botId: bot.id } });
  const audience = useQuery({ ...audienceOptions, retry: false });
  const restricted = audience.data?.restricted ?? false;
  const roles = useQuery({ ...queries.spaces.roles.list.queryOptions(), enabled: restricted });
  const members = useQuery({ ...queries.spaces.members.list.queryOptions(), enabled: restricted });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = bot.name;
  if (!audience.data) return null;
  const current = audience.data;

  async function save(next: typeof current) {
    setSaving(true);
    setError(null);
    try {
      const saved = await rpc.bots.audience.set({ botId: bot.id, ...next });
      queryClient.setQueryData(audienceOptions.queryKey, saved);
    } catch (err) {
      setError(errorText(err, t`Could not save`));
    } finally {
      setSaving(false);
    }
  }
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

  return (
    <section data-testid="agent-audience">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        <Trans>Who can talk to {name}</Trans>
      </h3>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={restricted ? "outline" : "default"}
            aria-pressed={!restricted}
            disabled={saving}
            onClick={() => void save({ ...current, restricted: false })}
          >
            <Trans>Everyone</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={restricted ? "default" : "outline"}
            aria-pressed={restricted}
            disabled={saving}
            onClick={() => void save({ ...current, restricted: true })}
          >
            <Trans>Only some roles or people</Trans>
          </Button>
        </div>
        {restricted ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {(roles.data?.roles ?? [])
                .filter((role) => role.systemKey !== "everyone")
                .map((role) => {
                  const picked = current.roleIds.includes(role.id);
                  return (
                    <Button
                      key={role.id}
                      type="button"
                      size="xs"
                      variant={picked ? "default" : "outline"}
                      aria-pressed={picked}
                      disabled={saving}
                      onClick={() =>
                        void save({ ...current, roleIds: toggle(current.roleIds, role.id) })
                      }
                    >
                      {picked ? <Check aria-hidden="true" /> : null}
                      {role.name}
                    </Button>
                  );
                })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(members.data ?? []).map((member) => {
                const picked = current.userIds.includes(member.userId);
                return (
                  <Button
                    key={member.userId}
                    type="button"
                    size="xs"
                    variant={picked ? "default" : "outline"}
                    aria-pressed={picked}
                    disabled={saving}
                    onClick={() =>
                      void save({ ...current, userIds: toggle(current.userIds, member.userId) })
                    }
                  >
                    {picked ? <Check aria-hidden="true" /> : null}
                    {member.name}
                  </Button>
                );
              })}
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <label htmlFor={`${ids}-consultable`} className="text-sm text-foreground">
                <Trans>Other agents can consult {name}</Trans>
              </label>
              <Switch
                id={`${ids}-consultable`}
                checked={current.consultable}
                disabled={saving}
                onCheckedChange={(checked) => void save({ ...current, consultable: checked })}
              />
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
