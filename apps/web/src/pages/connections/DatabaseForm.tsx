import type { DatabaseConnection, DatabaseSslMode } from "@corvo/contracts";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

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

/** A read-only PostgreSQL connection. It is saved only when a test connection succeeds. */
export function DatabaseForm({
  onSaved,
  onCancel,
}: {
  onSaved: (connection: DatabaseConnection) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const [fields, setFields] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const ready =
    draft.name.trim() && (fields ? draft.host && draft.database : draft.connectionString);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
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
    } catch (err) {
      setError(errorText(err, t`Could not save`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      data-testid="database-form"
      className="space-y-3"
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
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!ready || busy}>
          {busy ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setFields(!fields)}>
          {fields ? <Trans>Connection string</Trans> : <Trans>Details</Trans>}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </form>
  );
}
