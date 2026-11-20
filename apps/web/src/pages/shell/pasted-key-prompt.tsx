import type { PastedSecretMatch } from "@corvo/contracts";
import { BotSecretName, commandVariableName, commandVariableProblem } from "@corvo/contracts";
import { Button, Input } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

/** The name to save under: `base`, or `base-2`, `base-3`… when the bot already has that one. */
function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** How the agent refers to a saved key: the command variable its shell commands receive. */
export function credentialReference(name: string): string {
  return `$${commandVariableName(name)}`;
}

/**
 * Offered when a draft holds an API key or token. Saving keeps the key out of the chat: it is
 * stored as the agent's credential and the draft keeps only a reference. The key is read from
 * `secret` once, on save, and is never held in state, logged or reported.
 */
export function PastedKeyPrompt({
  botId,
  match,
  secret,
  onSaved,
  onSendAnyway,
  onDismiss,
}: {
  botId: string;
  match: PastedSecretMatch;
  secret: string;
  onSaved: (reference: string) => void;
  onSendAnyway: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const nameId = useId();
  const [name, setName] = useState(match.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const nameProblem =
    !BotSecretName.safeParse(trimmed).success ||
    commandVariableProblem(commandVariableName(trimmed)) !== undefined;

  async function save() {
    if (busy || nameProblem) return;
    setBusy(true);
    setError(null);
    try {
      const existing = await rpc.botSecrets.list({ botId });
      const finalName = freeName(trimmed, new Set(existing.map((entry) => entry.name)));
      await rpc.botSecrets.put({
        botId,
        destination: { name: finalName, auth: { type: "command" } },
        value: secret,
      });
      onSaved(credentialReference(finalName));
    } catch (err) {
      setError(errorText(err, t`Could not save the credential`));
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t`Key in message`}
      data-testid="pasted-key-prompt"
      className="relative mb-3 animate-in fade-in-0 slide-in-from-bottom-1 rounded-[14px] border border-border bg-card p-3 pr-9 duration-150 motion-reduce:animate-none"
    >
      <button
        type="button"
        aria-label={t`Dismiss`}
        onClick={onDismiss}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
      >
        <X size={13} strokeWidth={2} />
      </button>
      <p className="m-0 text-[14px] text-foreground">
        {t`This looks like a key. Save it as a credential instead?`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={nameId} className="sr-only">
          {t`Name`}
        </label>
        <Input
          id={nameId}
          data-testid="pasted-key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          aria-invalid={nameProblem}
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-48"
        />
        <Button
          type="button"
          size="sm"
          data-testid="pasted-key-save"
          disabled={busy || nameProblem}
          onClick={() => void save()}
        >
          {busy ? t`Saving…` : t`Save credential`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="pasted-key-send"
          disabled={busy}
          onClick={onSendAnyway}
        >
          {t`Send anyway`}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="m-0 mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
