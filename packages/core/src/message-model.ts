import type { ChatModelChoice, HostedModelBilling } from "./model-providers.js";
import {
  botModelKey,
  hostedModelsAvailable,
  messageModelChoices,
  modelOptionKey,
  parseModelOptionKey,
} from "./model-providers.js";

/**
 * The model chosen in a composer for what is sent next. It never touches the agent's saved model:
 * it travels with the message, and goes back to the agent's own once sent unless the person kept
 * it for the conversation.
 */
export type MessageModelState = {
  model: { provider: string; modelId: string } | null;
  keep: boolean;
};

export const NO_MESSAGE_MODEL: MessageModelState = { model: null, keep: false };

/** Picking the agent's own model clears the choice; any other model becomes it. */
export function pickMessageModel(
  state: MessageModelState,
  key: string,
  agentKey: string,
): MessageModelState {
  const parsed = key && key !== agentKey ? parseModelOptionKey(key) : null;
  return { ...state, model: parsed };
}

export function keepMessageModel(state: MessageModelState, keep: boolean): MessageModelState {
  return { ...state, keep };
}

/** The state once its message was accepted. */
export function afterMessageSent(state: MessageModelState): MessageModelState {
  return state.keep ? state : NO_MESSAGE_MODEL;
}

/**
 * What a composer offers for one agent's chat, or `null` when there is nothing to pick: fewer than
 * two usable chat models, or a partner that fixes the model for its customers.
 */
export function messageModelOptions(input: {
  credentials: Parameters<typeof messageModelChoices>[0];
  catalog: Parameters<typeof messageModelChoices>[1];
  billing: HostedModelBilling | undefined;
  bot: { modelProvider?: string | null; modelId?: string | null };
  me: {
    defaultProvider?: string | null;
    defaultModel?: string | null;
    partner?: { models?: string } | null;
  } | null;
}): { choices: ChatModelChoice[]; agentKey: string } | null {
  const choices = messageModelChoices(
    input.credentials,
    input.catalog,
    hostedModelsAvailable(input.billing),
  );
  if (choices.filter((choice) => !choice.disabled).length < 2) return null;
  if (input.me?.partner?.models === "fixed") return null;
  const { me } = input;
  const agentKey =
    botModelKey(input.bot, input.catalog) ||
    (me?.defaultProvider && me.defaultModel
      ? modelOptionKey(me.defaultProvider, me.defaultModel)
      : "");
  return { choices, agentKey };
}

/** The choice per agent chat, with the subscription a UI needs to follow it. */
export function createMessageModelStore() {
  const states = new Map<string, MessageModelState>();
  const listeners = new Set<() => void>();
  const get = (botId: string): MessageModelState => states.get(botId) ?? NO_MESSAGE_MODEL;
  const set = (botId: string, next: MessageModelState) => {
    if (next === NO_MESSAGE_MODEL) states.delete(botId);
    else states.set(botId, next);
    for (const listener of listeners) listener();
  };
  return {
    get,
    set,
    /** Call once the message went out: a choice not kept for the conversation is spent. */
    settle(botId: string) {
      const current = get(botId);
      const next = afterMessageSent(current);
      if (next !== current) set(botId, next);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
