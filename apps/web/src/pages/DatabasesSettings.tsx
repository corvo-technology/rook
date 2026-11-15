import type { DatabaseConnection, DatabaseSslMode } from "@corvo/contracts";
import {
  Button,
  InlineConfirm,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Draft = {
  name: string;
  connectionString: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslMode: DatabaseSslMode;
};

const EMPTY: Draft = {
  name: "",
  connectionString: "",
  host: "",
  port: "5432",
  database: "",
  user: "",
  password: "",
  sslMode: "require",
};

/** Read-only PostgreSQL connections the space's agents may query, and which agents may. */
export function DatabasesSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const client = useQueryClient();
  const listOptions = queries.databases.list.queryOptions();
  const list = useQuery(listOptions);
  const bots = (useQuery(queries.bots.list.queryOptions()).data ?? []).filter(
    (bot) => !bot.archivedAt,
  );
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replace = (next: DatabaseConnection) =>
    client.setQueryData<DatabaseConnection[]>(listOptions.queryKey, (current = []) =>
      current.some((row) => row.id === next.id)
        ? current.map((row) => (row.id === next.id ? next : row))
        : [...current, next],
    );
  const act = async (key: string, run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(errorText(err, t`Could not save`));
    } finally {
      setBusy(null);
    }
  };
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const connect = () =>
    act("create", async () => {
      replace(
        await rpc.databases.create(
          fields
            ? {
                name: draft.name,
                host: draft.host,
                port: Number(draft.port) || undefined,
                database: draft.database,
                user: draft.user,
                password: draft.password,
                sslMode: draft.sslMode,
              }
            : { name: draft.name, connectionString: draft.connectionString },
        ),
      );
      setDraft(EMPTY);
      setAdding(false);
    });

  const rows = list.data ?? [];
  const ready =
    draft.name.trim() && (fields ? draft.host && draft.database : draft.connectionString);

  return (
    <div data-testid="databases-settings" className="space-y-4">
      {rows.length > 0 ? (
        <SettingsGroup>
          {rows.map((row) => (
            <SettingsRow
              key={row.id}
              label={
                <span className="block min-w-0">
                  <span className="block truncate font-medium">{row.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {row.user}@{row.host}/{row.database}
                    {row.testedOk === false ? ` · ${t`Not reachable`}` : ""}
                  </span>
                </span>
              }
              control={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(`test-${row.id}`, async () =>
                        replace(await rpc.databases.test({ id: row.id })),
                      )
                    }
                  >
                    <Trans>Test</Trans>
                  </Button>
                  <InlineConfirm
                    variant="ghost"
                    size="sm"
                    confirmLabel={t`Remove ${row.name}?`}
                    onConfirm={() =>
                      void act(`remove-${row.id}`, async () => {
                        await rpc.databases.remove({ id: row.id });
                        client.setQueryData<DatabaseConnection[]>(
                          listOptions.queryKey,
                          (current = []) => current.filter((other) => other.id !== row.id),
                        );
                      })
                    }
                  >
                    <Trans>Remove</Trans>
                  </InlineConfirm>
                </>
              }
            >
              {bots.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    <Trans>Agents:</Trans>
                  </span>
                  {bots.map((bot) => {
                    const granted = row.botIds.includes(bot.id);
                    return (
                      <Button
                        key={bot.id}
                        type="button"
                        variant={granted ? "default" : "outline"}
                        size="xs"
                        aria-pressed={granted}
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`grant-${row.id}`, async () =>
                            replace(
                              await rpc.databases.setGrants({
                                id: row.id,
                                botIds: granted
                                  ? row.botIds.filter((id) => id !== bot.id)
                                  : [...row.botIds, bot.id],
                              }),
                            ),
                          )
                        }
                      >
                        {granted ? <Check aria-hidden="true" /> : null}
                        {bot.name}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </SettingsRow>
          ))}
        </SettingsGroup>
      ) : null}
      {adding ? (
        <form
          className="space-y-3 rounded-xl border border-border px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void connect();
          }}
        >
          <Input
            aria-label={t`Name`}
            placeholder={t`Name`}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            autoComplete="off"
          />
          {fields ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  aria-label={t`Host`}
                  placeholder={t`Host`}
                  value={draft.host}
                  onChange={(event) => set({ host: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Input
                  aria-label={t`Port`}
                  placeholder={t`Port`}
                  className="w-24"
                  inputMode="numeric"
                  value={draft.port}
                  onChange={(event) => set({ port: event.target.value })}
                />
              </div>
              <Input
                aria-label={t`Database`}
                placeholder={t`Database`}
                value={draft.database}
                onChange={(event) => set({ database: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex gap-2">
                <Input
                  aria-label={t`User`}
                  placeholder={t`User`}
                  value={draft.user}
                  onChange={(event) => set({ user: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Input
                  aria-label={t`Password`}
                  placeholder={t`Password`}
                  type="password"
                  value={draft.password}
                  onChange={(event) => set({ password: event.target.value })}
                  autoComplete="new-password"
                />
              </div>
              <Select
                value={draft.sslMode}
                onValueChange={(value) => set({ sslMode: value as DatabaseSslMode })}
              >
                <SelectTrigger aria-label={t`SSL`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="require">{t`Encrypted`}</SelectItem>
                  <SelectItem value="verify-full">{t`Encrypted, verified`}</SelectItem>
                  <SelectItem value="disable">{t`Not encrypted`}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Input
              aria-label={t`Connection string`}
              placeholder="postgres://user:password@host:5432/database"
              type="password"
              value={draft.connectionString}
              onChange={(event) => set({ connectionString: event.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          )}
          <p className="text-[12px] text-muted-foreground">
            <Trans>Use a read-only database role.</Trans>
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!ready || busy !== null}>
              {busy === "create" ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFields(!fields)}>
              {fields ? <Trans>Connection string</Trans> : <Trans>Details</Trans>}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
                setError(null);
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Trans>Add database</Trans>
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
