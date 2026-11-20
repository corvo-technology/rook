import type { CorvoDesktopConnections } from "@corvo/contracts";
import { Button, InlineConfirm, Input } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { errorText } from "../lib/user-error";

type Key = "composioApiKey" | "telegramBotToken";

/** Keys for the apps this computer's Rook connects to itself. A saved key is never shown again. */
export function ConnectionsSettingsPanel() {
  const { t } = useLingui();
  const [status, setStatus] = useState<CorvoDesktopConnections | null>(null);
  const [busy, setBusy] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void desktopBridge()
      ?.connections?.status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: Key, value: string | null) {
    const connections = desktopBridge()?.connections;
    if (!connections || busy) return;
    setBusy(key);
    setError(null);
    try {
      setStatus(await connections.save({ [key]: value }));
    } catch (err) {
      setError(errorText(err, t`Could not save`));
    } finally {
      setBusy(null);
    }
  }

  if (!status) return null;
  return (
    <div data-testid="connections-settings" className="space-y-4">
      <KeyRow
        id="telegram"
        name="telegramBotToken"
        title={t`Telegram`}
        hint={t`Create a bot with @BotFather and paste its token.`}
        label={t`Bot token`}
        connected={status.telegram}
        busy={busy === "telegramBotToken"}
        disabled={busy !== null}
        onSave={(value) => save("telegramBotToken", value)}
      />
      <KeyRow
        id="composio"
        name="composioApiKey"
        title={t`Composio`}
        hint={t`Find your API key in the Composio dashboard.`}
        label={t`API key`}
        connected={status.composio}
        busy={busy === "composioApiKey"}
        disabled={busy !== null}
        onSave={(value) => save("composioApiKey", value)}
      />
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function KeyRow({
  id,
  name,
  title,
  hint,
  label,
  connected,
  busy,
  disabled,
  onSave,
}: {
  id: string;
  name: Key;
  title: string;
  hint: string;
  label: string;
  connected: boolean;
  busy: boolean;
  disabled: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const { t } = useLingui();
  const [value, setValue] = useState("");
  return (
    <div className="rounded-xl border border-border px-4 py-4">
      <h3 className="text-heading3 font-medium text-foreground">{title}</h3>
      {connected ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[13px] text-muted-foreground">
            <Trans>Connected</Trans>
          </span>
          <InlineConfirm
            type="button"
            variant="outline"
            size="sm"
            data-testid={`remove-${id}`}
            disabled={disabled}
            confirmLabel={t`Remove ${title}?`}
            onConfirm={() => void onSave(null)}
          >
            <Trans>Remove</Trans>
          </InlineConfirm>
        </div>
      ) : (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim()) return;
            void onSave(value).then(() => setValue(""));
          }}
        >
          <Input
            name={name}
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={label}
            placeholder={label}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            size="sm"
            data-testid={`save-${id}`}
            disabled={disabled || !value.trim()}
          >
            {busy ? <Trans>Restarting…</Trans> : <Trans>Save</Trans>}
          </Button>
        </form>
      )}
      {connected ? null : (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
