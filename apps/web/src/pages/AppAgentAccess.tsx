import type { BotMcpServer, McpServer } from "@corvo/contracts";
import { writeSaved } from "@corvo/core/query";
import { Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { setAgentAccess } from "../lib/mcp-access";
import { useSpaceQueries } from "../lib/query";
import { errorText } from "../lib/user-error";

/** Which agents can use an added app, one tap each, where the app is opened. */
export function AppAgentAccess({ server }: { server: McpServer }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const assignmentsOptions = queries.mcp.assignments.all.queryOptions();
  const botsQuery = useQuery(queries.bots.list.queryOptions());
  const assignmentsQuery = useQuery(assignmentsOptions);
  const [error, setError] = useState<string | null>(null);
  const bots = useMemo(
    () => (botsQuery.data ?? []).filter((bot) => !bot.archivedAt),
    [botsQuery.data],
  );
  // The change merges into each agent's full list, so it waits for a settled read of every one.
  const ready = assignmentsQuery.isSuccess && !assignmentsQuery.isFetching;
  if (bots.length === 0) return null;
  const all: BotMcpServer[] = assignmentsQuery.data ?? [];

  async function toggle(botId: string, allowed: boolean) {
    setError(null);
    try {
      const updated = await setAgentAccess(
        botId,
        server.id,
        all.filter((entry) => entry.botId === botId),
        allowed,
      );
      await writeSaved(queryClient, assignmentsOptions.queryKey, (current) => [
        ...(current ?? []).filter((entry) => entry.botId !== botId),
        ...updated,
      ]);
    } catch (err) {
      setError(errorText(err, t`Could not update agent access`));
    }
  }

  return (
    <div data-testid="app-agent-access" className="space-y-2">
      <div className="text-[13px] text-muted-foreground">
        <Trans>Agents that can use it</Trans>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {bots.map((bot) => {
          const allowed = all.some(
            (entry) => entry.botId === bot.id && entry.serverId === server.id,
          );
          return (
            <Button
              key={bot.id}
              type="button"
              variant={allowed ? "default" : "outline"}
              size="xs"
              aria-pressed={allowed}
              disabled={!ready}
              onClick={() => void toggle(bot.id, !allowed)}
            >
              {allowed ? <Check aria-hidden="true" /> : null}
              {bot.name}
            </Button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
