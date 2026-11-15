import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useSpaceQueries } from "../../lib/query";

/** What an agent has connected, by name: every member may read it, only managers change it. */
export function AgentConnectionsList({ botId }: { botId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const { data } = useQuery(queries.connections.forAgent.queryOptions({ input: { botId } }));
  if (!data?.length) return null;
  return (
    <section data-testid="agent-connections">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t`Apps`}</h3>
      <ul className="space-y-1 text-sm">
        {data.map((entry) => (
          <li key={`${entry.kind}:${entry.name}`} className="flex items-center justify-between">
            <span className="truncate">{entry.name}</span>
            {entry.status === "error" ? (
              <span className="text-xs text-destructive">{t`Error`}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
