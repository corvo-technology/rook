import type { Bot } from "@corvo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { AgentLabel, LevelSelect } from "./AccessList";
import type { AccessLevelChoice, ConnectionItem, ShownLevel } from "./connection-model";
import { levelChoices, levelLabel } from "./connection-model";

/** Past this many agents, finding one by name is worth a search box. */
const SEARCH_FROM = 6;

/** Who can use one connection, and how far: every agent with a level to pick. */
export function AccessSheet({
  item,
  agents,
  levels,
  onChange,
  onClose,
}: {
  item: ConnectionItem;
  agents: readonly Bot[];
  levels: ReadonlyMap<string, ShownLevel>;
  /** Sets the level for these agents; rejects with the reason it could not. */
  onChange: (botIds: string[], level: AccessLevelChoice) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wanted = query.trim().toLowerCase();
  const shown = wanted
    ? agents.filter((bot) => `${bot.name} ${bot.title}`.toLowerCase().includes(wanted))
    : agents;

  async function set(botIds: string[], level: AccessLevelChoice) {
    setBusy(true);
    setError(null);
    try {
      await onChange(botIds, level);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t`Could not update agent access`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent data-testid="access-sheet" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            <Trans>Who can use {item.name}</Trans>
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <div className="flex items-center gap-2">
            {agents.length >= SEARCH_FROM ? (
              <Input
                aria-label={t`Search agents`}
                placeholder={t`Search agents`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : (
              <span className="flex-1" />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="outline" size="sm" disabled={busy} />}
              >
                <Trans>Everyone</Trans>
                <ChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {levelChoices(item.kind).map((level) => (
                  <DropdownMenuItem
                    key={level}
                    onClick={() =>
                      void set(
                        shown.map((bot) => bot.id),
                        level,
                      )
                    }
                  >
                    {levelLabel(level)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ul className="divide-y divide-border">
            {shown.map((bot) => (
              <li
                key={bot.id}
                data-testid="access-agent"
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <AgentLabel bot={bot} />
                <LevelSelect
                  kind={item.kind}
                  label={t`Access for ${bot.name}`}
                  value={levels.get(bot.id) ?? "none"}
                  disabled={busy}
                  onChange={(level) => void set([bot.id], level)}
                />
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
