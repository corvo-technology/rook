import type { ModelCatalogEntry } from "@corvo/contracts";
import { detectProviderFromKey, pickCatalogModelId } from "@corvo/core";
import { Button, Input } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { useLocalTools } from "../lib/local-tools";
import { runModelConnectionPreflight } from "../lib/model-connection-preflight";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/**
 * The one-step way to connect a model: paste a key, and the provider, the model and the key check
 * follow from it. Subscriptions and every other provider stay one click away.
 */
export function QuickKeyConnect({
  catalog,
  signInOptions,
  onSelectProvider,
  onMore,
  onConnected,
  onEdit,
}: {
  catalog: readonly ModelCatalogEntry[];
  /** Sign-in with a subscription, as the provider list names them. */
  signInOptions: ReadonlyArray<{ value: string; label: string }>;
  onSelectProvider: (option: string) => void;
  onMore: () => void;
  onConnected: () => void;
  /** The person started typing a key. */
  onEdit?: () => void;
}) {
  const { t } = useLingui();
  const fieldId = useId();
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tools = useLocalTools();
  // A subscription whose tool is already installed here is the one this person most likely has.
  const found = (option: { value: string }) =>
    (option.value === "openai-codex" && tools.codex) ||
    (option.value === "anthropic:sign-in" && tools.claude);
  const subscriptions = [...signInOptions].sort((a, b) => Number(found(b)) - Number(found(a)));

  const provider = detectProviderFromKey(key);
  const entry = provider ? catalog.find((item) => item.provider === provider) : undefined;
  const providerName = entry?.providerName ?? provider;

  async function connect() {
    if (!provider || !entry || pending) return;
    setPending(true);
    setError(null);
    const apiKey = key.trim();
    const modelId = pickCatalogModelId([...catalog], provider);
    const checked = await runModelConnectionPreflight({
      authKind: "api-key",
      provider,
      apiKey,
      modelId,
      catalogProbe: true,
      probeCatalog: rpc.models.probeCatalog,
    });
    // A provider that cannot be listed in advance is verified by saving, as in the full form.
    if (!checked.ok && checked.failure.outcome !== "unknown") {
      setError(`${checked.failure.message} ${checked.failure.nextAction}`);
      setPending(false);
      return;
    }
    try {
      await rpc.models.connect({
        provider,
        apiKey,
        modelId,
        label: providerName ?? provider,
      });
      onConnected();
    } catch (err) {
      setError(errorText(err, t`Could not save model`));
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <div className="grid gap-2">
        {subscriptions.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            size="lg"
            data-sign-in
            className="h-auto justify-between py-3"
            onClick={() => onSelectProvider(option.value)}
          >
            {option.label}
            {found(option) ? (
              <span className="text-xs font-normal text-primary">
                <Trans>Found on this computer</Trans>
              </span>
            ) : null}
          </Button>
        ))}
      </div>
      <hr className="my-6 border-border" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
          <Trans>API key</Trans>
        </label>
        <Input
          id={fieldId}
          type="password"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            onEdit?.();
            setError(null);
          }}
          aria-label={t`API key`}
          placeholder={t`Paste your API key`}
          autoComplete="off"
          spellCheck={false}
          className="mt-2"
        />
        {entry ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {providerName}
          </p>
        ) : key.trim() ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            <Trans>Key not recognized. Choose a provider.</Trans>
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="mt-6" type="submit" disabled={!entry || pending}>
          {pending ? <Trans>Testing…</Trans> : <Trans>Continue</Trans>}
        </Button>
      </form>
      <button
        type="button"
        className="mt-6 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={onMore}
      >
        <Trans>Other providers</Trans>
      </button>
    </div>
  );
}
