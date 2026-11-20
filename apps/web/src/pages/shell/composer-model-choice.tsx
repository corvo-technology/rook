import type { Bot, ModelCatalogEntry } from "@corvo/contracts";
import {
  keepMessageModel,
  messageModelOptions,
  modelOptionKey,
  pickMessageModel,
} from "@corvo/core";
import { Label, Switch } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useBilling } from "../../components/SubscriptionGate";
import { messageModels, useMessageModel } from "../../lib/message-model";
import { useSpaceQueries } from "../../lib/query";
import { ChatModelPicker } from "./chat-model-picker";

const NO_CREDENTIALS: never[] = [];
const NO_CATALOG: ModelCatalogEntry[] = [];

/**
 * Picks the model for the next message. Shown only when there is more than one to pick from; it
 * starts on the agent's own model and never changes the agent's saved setting.
 */
export function ComposerModelChoice({ bot }: { bot: Bot }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const credentials = useQuery(queries.models.credentials.queryOptions()).data ?? NO_CREDENTIALS;
  const catalog = useQuery(queries.models.list.queryOptions()).data ?? NO_CATALOG;
  const me = useQuery(queries.me.queryOptions()).data ?? null;
  const { status: billing } = useBilling();
  const state = useMessageModel(bot.id);

  const options = messageModelOptions({ credentials, catalog, billing, bot, me });
  if (!options) return null;
  const value = state.model
    ? modelOptionKey(state.model.provider, state.model.modelId)
    : options.agentKey;

  return (
    <ChatModelPicker
      chip
      id={`message-model-${bot.id}`}
      choices={options.choices}
      value={value}
      onChange={(key) => messageModels.set(bot.id, pickMessageModel(state, key, options.agentKey))}
      footer={
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <Label htmlFor={`message-model-keep-${bot.id}`}>{t`For this conversation`}</Label>
          <Switch
            id={`message-model-keep-${bot.id}`}
            checked={state.keep}
            onCheckedChange={(keep) => messageModels.set(bot.id, keepMessageModel(state, keep))}
          />
        </div>
      }
    />
  );
}
