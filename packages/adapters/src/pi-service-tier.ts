import type { Api, Model } from "@earendil-works/pi-ai";

type PayloadHook = (payload: unknown, model: never) => unknown | Promise<unknown>;

/** Wire protocols whose request body carries a `service_tier` field. */
const SERVICE_TIER_APIS = new Set<Api>(["openai-responses", "openai-completions"]);

/**
 * Stream options that ask for the cheaper tier a connection declared, added after any onPayload
 * hook already there. Does nothing without a declared tier or on a protocol with no such field,
 * and never overrides a tier the payload already names.
 */
export function withBackgroundServiceTier<O extends object>(
  options: O | undefined,
  model: Pick<Model<Api>, "api">,
  tier: string | undefined,
): O | undefined {
  if (!tier || !SERVICE_TIER_APIS.has(model.api)) return options;
  const previous = (options as { onPayload?: PayloadHook } | undefined)?.onPayload;
  return {
    ...(options ?? {}),
    onPayload: async (payload: unknown, requestModel: never) => {
      const replaced = (previous ? await previous(payload, requestModel) : undefined) ?? payload;
      if (typeof replaced !== "object" || replaced === null) return replaced;
      return "service_tier" in replaced ? replaced : { ...replaced, service_tier: tier };
    },
  } as O;
}
