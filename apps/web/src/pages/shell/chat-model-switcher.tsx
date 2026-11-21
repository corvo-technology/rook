import type { Bot, ModelCatalogEntry } from "@corvo/contracts";
import {
  botModelKey,
  chatModelChoices,
  connectedModelChoices,
  modelChangePatch,
} from "@corvo/core";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { ChatModelPicker } from "./chat-model-picker";

const NO_CREDENTIALS: never[] = [];
const NO_CATALOG: ModelCatalogEntry[] = [];

/** Switches the model of the chat that is open, without leaving it. */
export function ChatModelSwitcher({
  bot,
  onChange,
}: {
  bot: Bot;
  onChange: (patch: ReturnType<typeof modelChangePatch>) => Promise<void>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const credentials = useQuery(queries.models.credentials.queryOptions()).data ?? NO_CREDENTIALS;
  const catalog = useQuery(queries.models.list.queryOptions()).data ?? NO_CATALOG;
  const me = useQuery(queries.me.queryOptions()).data ?? null;
  const [error, setError] = useState<string | null>(null);

  const selectedKey = botModelKey(bot, catalog);
  const defaultEntry = me?.defaultModel
    ? catalog.find((entry) => entry.provider === me.defaultProvider && entry.id === me.defaultModel)
    : undefined;
  const choices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selectedKey,
    t`Space default`,
    defaultEntry?.images,
  );
  // With nothing else connected there is nothing to switch to, and a partner may keep the model
  // the same for all its customers.
  if (choices.length < 2 || me?.partner?.models === "fixed") return null;

  return (
    // On a phone the composer's picker is the one model control; the header keeps its room for the name.
    <div
      title={error ?? undefined}
      data-invalid={error ? "" : undefined}
      className="hidden md:block"
    >
      <ChatModelPicker
        chip
        id={`chat-model-${bot.id}`}
        choices={choices}
        value={selectedKey}
        onChange={(key) => {
          setError(null);
          onChange(modelChangePatch(key)).catch((err: unknown) =>
            setError(errorText(err, t`Could not save`)),
          );
        }}
      />
    </div>
  );
}
