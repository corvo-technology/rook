import type {
  AgentCatalogEntry,
  AgentCatalogLocale,
  McpServer,
  StoreCategory,
} from "@corvo/contracts";
import { agentCatalogLocale, agentCatalogSpawnKey, STORE_CATEGORIES } from "@corvo/contracts";
import { AGENT_CATALOG, APP_CATALOG } from "@corvo/core";
import { BotAvatar, Button } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { addCatalogAgent, connectedServersFor } from "../lib/agent-catalog-install";
import { useSpaceQueries } from "../lib/query";
import { usePartnerNames } from "../lib/use-partners";
import { errorText } from "../lib/user-error";
import { StoreCategoryChips } from "./StoreCategoryChips";

const appName = (slug: string) => APP_CATALOG.find((app) => app.slug === slug)?.name ?? slug;

function matches(entry: AgentCatalogEntry, locale: AgentCatalogLocale, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.name[locale]} ${entry.description[locale]}`.toLowerCase().includes(needle);
}

/** Ready-made agents. Adding one creates a bot; apps it needs that are not connected are offered next. */
export function AgentsStore({
  servers,
  query,
  onOpenApp,
}: {
  servers: readonly McpServer[];
  query: string;
  /** Opens the Apps section on that app, so it can be connected. */
  onOpenApp: (slug: string) => void;
}) {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const locale = agentCatalogLocale(i18n.locale);
  const queries = useSpaceQueries();
  const bots = useQuery(queries.bots.list.queryOptions());
  const skills = useQuery(queries.agentSkills.list.queryOptions());
  const emailStatus = useQuery(queries.emailAgent.status.queryOptions());
  // Mail reaches the agent through a callback to this server, which needs a public https address.
  // Without one the agent checks the inbox on a schedule its owner approves. Assumed instant until
  // the server says otherwise, so the note does not flash.
  const emailChecksOnSchedule = emailStatus.data?.available === false;
  const [category, setCategory] = useState<StoreCategory | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addedBot = (entry: AgentCatalogEntry) =>
    bots.data?.find(
      (bot) =>
        !bot.archivedAt &&
        (entry.setup === "email"
          ? bot.spawnKey?.startsWith("email-agent:")
          : bot.spawnKey === agentCatalogSpawnKey(entry.slug)),
    );

  async function add(entry: AgentCatalogEntry) {
    setPending(entry.slug);
    setError(null);
    try {
      const { botId } = await addCatalogAgent(
        entry,
        locale,
        servers,
        (skills.data ?? []).map((skill) => skill.name),
      );
      await Promise.all([bots.refetch(), skills.refetch()]);
      if (entry.setup === "email") navigate(`/app/${botId}`);
    } catch (err) {
      setError(errorText(err, t`Could not add the agent`));
    } finally {
      setPending(null);
    }
  }

  // Partner agents are offered only to an organization that is a member of a partner.
  const hasPartner = usePartnerNames().length > 0;
  const offered = AGENT_CATALOG.filter((entry) => hasPartner || !entry.partnerAccess);
  const entries = offered.filter(
    (entry) => (!category || entry.category === category) && matches(entry, locale, query),
  );
  const categories = STORE_CATEGORIES.filter((item) =>
    offered.some((entry) => entry.category === item),
  );

  return (
    <div data-testid="agent-catalog">
      <StoreCategoryChips categories={categories} value={category} onChange={setCategory} />
      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          <Trans>No results</Trans>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {entries.map((entry) => {
          const added = addedBot(entry);
          const connected = new Set(
            connectedServersFor(entry, servers).map((server) => server.slug),
          );
          // The email agent needs any one inbox service; every other agent needs each of its apps.
          const missing =
            entry.setup === "email"
              ? connected.size > 0
                ? []
                : entry.apps
              : entry.apps.filter((slug) => !connected.has(slug));
          return (
            <div
              key={entry.slug}
              data-testid={`agent-card-${entry.slug}`}
              className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <BotAvatar color={entry.color} identity={entry.slug} size={44} />
                <div className="min-w-0 flex-1 truncate text-[15.5px] font-medium">
                  {entry.name[locale]}
                </div>
                {added ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => navigate(`/app/${added.id}`)}
                  >
                    <Check />
                    <Trans>Added</Trans>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={
                      pending === entry.slug || (entry.setup === "email" && missing.length > 0)
                    }
                    onClick={() => void add(entry)}
                  >
                    <Plus />
                    <Trans>Add</Trans>
                  </Button>
                )}
              </div>
              <p className="text-[14px] leading-snug text-foreground/75">
                {entry.description[locale]}
              </p>
              {entry.setup === "email" && emailChecksOnSchedule && !added ? (
                <p className="text-[13px] text-muted-foreground">
                  <Trans>
                    No public address here, so it checks your inbox on a schedule you approve.
                  </Trans>
                </p>
              ) : null}
              {missing.length > 0 && (added || entry.setup === "email") ? (
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((slug) => (
                    <Button
                      key={slug}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => onOpenApp(slug)}
                    >
                      <Trans>Connect {appName(slug)}</Trans>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
