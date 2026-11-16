import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { LevelSelect } from "./AccessList";
import type { AccessLevelChoice } from "./connection-model";
import { levelsFor } from "./connection-model";
import { useConnections } from "./use-connections";

/**
 * What one agent may use, connection by connection, with the same levels as each connection's
 * Access sheet. Nothing shows until there is a connection to give.
 */
export function AgentAccessSection({ botId }: { botId: string }) {
  const { t } = useLingui();
  const { items, access, refresh } = useConnections();
  const [error, setError] = useState<string | null>(null);
  // Someone else's connection is not this member's to lend.
  const lendable = items.filter((item) => !item.otherOwner);
  if (lendable.length === 0) return null;

  async function set(kind: (typeof items)[number]["kind"], id: string, level: AccessLevelChoice) {
    setError(null);
    try {
      await rpc.access.set({ kind, connectionId: id, botIds: [botId], level });
      await refresh();
    } catch (failure) {
      setError(errorText(failure, t`Could not update agent access`));
    }
  }

  return (
    <section data-testid="agent-access">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        <Trans>Access</Trans>
      </h3>
      <ul className="space-y-2">
        {lendable.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-foreground">{item.name}</span>
            <LevelSelect
              kind={item.kind}
              label={item.name}
              value={levelsFor(access, item.kind, item.id).get(botId) ?? "none"}
              onChange={(level) => void set(item.kind, item.id, level)}
            />
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </section>
  );
}
