import type { AppCatalogEntry, AppCategory, McpServer } from "@corvo/contracts";
import { APP_CATEGORIES } from "@corvo/contracts";
import { APP_CATALOG, appsForSurface, filterAppCatalog, matchAddedServer } from "@corvo/core";
import { Button, Input } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { connectCatalogApp, giveAgentAccess } from "../lib/app-catalog-connect";
import { desktopBridge } from "../lib/desktop";
import { errorText } from "../lib/user-error";
import { AppAgentAccess } from "./AppAgentAccess";

function AppIcon({ entry }: { entry: AppCatalogEntry }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-sm font-semibold text-foreground">
      {entry.name[0]}
    </div>
  ) : (
    <img
      src={entry.iconUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="h-9 w-9 shrink-0 rounded-xl bg-accent object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function shownApps(): AppCatalogEntry[] {
  return appsForSurface(APP_CATALOG, { systemBrowser: Boolean(desktopBridge()?.oauth?.open) });
}

/** Built-in apps people can add in one step; the Integrations overlay renders this above its connector catalog. */
export function AppCatalogGrid({
  query,
  servers,
  onUsePrompt,
  onChanged,
  focus,
  botId,
  hideAccess = false,
  singleColumn = false,
}: {
  query: string;
  servers: readonly McpServer[];
  /** Absent when there is no bot to send an example prompt to. */
  onUsePrompt?: (text: string) => void;
  onChanged: () => void;
  /** Opens that app's detail; `n` changes with each request so choosing the same app twice works. */
  focus?: { slug: string; n: number };
  /** The agent the apps are added for; it can use each one it adds or sends an example to. */
  botId?: string;
  /** Leaves out the agent chips: who may use an app is the Connections page's Access sheet. */
  hideAccess?: boolean;
  /** One app per line, for a narrow panel. */
  singleColumn?: boolean;
}) {
  const { t } = useLingui();
  const [category, setCategory] = useState<AppCategory | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (focus) setSelected(focus.slug);
  }, [focus]);

  const categoryLabels: Record<AppCategory, string> = {
    coding: t`Coding`,
    productivity: t`Productivity`,
    data: t`Data`,
    design: t`Design`,
    automation: t`Automation`,
  };

  async function run(entry: AppCatalogEntry, existing?: McpServer, apiKey?: string) {
    setPending(entry.slug);
    setError(null);
    try {
      await connectCatalogApp(entry, { key: apiKey, existing, botId });
      setKey("");
      onChanged();
    } catch (err) {
      setError(errorText(err, t`Could not connect`));
    } finally {
      setPending(null);
    }
  }

  // An app added before it was tied to an agent still works for the agent asked about it.
  async function sendPrompt(prompt: string, server?: McpServer) {
    setError(null);
    try {
      if (botId && server) await giveAgentAccess(botId, server.id);
      onUsePrompt?.(prompt);
    } catch (err) {
      setError(errorText(err, t`Could not connect`));
    }
  }

  const detail = selected ? APP_CATALOG.find((entry) => entry.slug === selected) : undefined;
  if (detail) {
    const server = matchAddedServer(detail, servers);
    const signedIn = server && (detail.auth.kind !== "oauth" || server.oauthStatus === "connected");
    return (
      <div data-testid="app-detail" className="mb-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={t`Back`}
            onClick={() => setSelected(null)}
          >
            <ChevronLeft />
          </Button>
          <AppIcon entry={detail} />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-medium text-foreground">{detail.name}</div>
            <div className="truncate text-[13px] text-muted-foreground">{detail.tagline}</div>
          </div>
        </div>
        {!server && detail.auth.kind === "key" ? (
          <div className="space-y-2">
            <Input
              type="password"
              value={key}
              aria-label={detail.auth.label}
              placeholder={detail.auth.label}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
            <a
              href={detail.auth.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-[13px] text-muted-foreground underline"
            >
              {detail.auth.hint}
            </a>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending === detail.slug || !key.trim()}
              onClick={() => void run(detail, undefined, key)}
            >
              {pending === detail.slug ? <Trans>Adding…</Trans> : <Trans>Add</Trans>}
            </Button>
          </div>
        ) : null}
        {server && !hideAccess ? <AppAgentAccess server={server} /> : null}
        {signedIn && onUsePrompt ? (
          <div className="flex flex-wrap gap-2">
            {detail.prompts.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void sendPrompt(prompt, server)}
              >
                {prompt}
              </Button>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      </div>
    );
  }

  const catalog = shownApps();
  const entries = filterAppCatalog(catalog, { query, category });
  // Keep the chips while a category is set, so it can still be cleared.
  if (entries.length === 0 && category === null) return null;

  function action(entry: AppCatalogEntry) {
    const server = matchAddedServer(entry, servers);
    const busy = pending === entry.slug;
    if (busy) {
      return (
        <Button type="button" variant="secondary" size="sm" disabled>
          <Trans>Adding…</Trans>
        </Button>
      );
    }
    if (!server) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            if (entry.auth.kind === "key") setSelected(entry.slug);
            else void run(entry);
          }}
        >
          <Trans>Add</Trans>
        </Button>
      );
    }
    if (entry.auth.kind === "oauth" && server.oauthStatus !== "connected") {
      return (
        <Button type="button" variant="secondary" size="sm" onClick={() => void run(entry, server)}>
          <Trans>Sign in</Trans>
        </Button>
      );
    }
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(entry.slug)}>
        <Trans>Added</Trans>
      </Button>
    );
  }

  return (
    <div className="mb-6" data-testid="app-catalog">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={category === null ? "secondary" : "ghost"}
          onClick={() => setCategory(null)}
        >
          <Trans>All</Trans>
        </Button>
        {APP_CATEGORIES.filter((item) => catalog.some((entry) => entry.category === item)).map(
          (item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={category === item ? "secondary" : "ghost"}
              onClick={() => setCategory(item)}
            >
              {categoryLabels[item]}
            </Button>
          ),
        )}
      </div>
      <div className={`grid gap-2 ${singleColumn ? "grid-cols-1" : "grid-cols-2"}`}>
        {entries.map((entry) => (
          <div
            key={entry.slug}
            data-testid={`app-tile-${entry.slug}`}
            className="flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-start hover:bg-accent/60"
              onClick={() => setSelected(entry.slug)}
            >
              <AppIcon entry={entry} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-foreground">{entry.name}</div>
                <div className="truncate text-[12.5px] text-muted-foreground">{entry.tagline}</div>
              </div>
            </button>
            {action(entry)}
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
