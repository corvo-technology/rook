import { describe, expect, it } from "vitest";
import { withBackgroundServiceTier } from "./pi-service-tier.js";

type Options = { onPayload?: (payload: unknown, model: never) => unknown };
const run = async (options: Options | undefined, payload: unknown) =>
  options?.onPayload?.(payload, undefined as never);

describe("withBackgroundServiceTier", () => {
  it("adds the declared tier on protocols that carry one", async () => {
    for (const api of ["openai-responses", "openai-completions"] as const) {
      const out = withBackgroundServiceTier<Options>(undefined, { api }, "flex");
      expect(await run(out, { model: "m" })).toEqual({ model: "m", service_tier: "flex" });
    }
  });

  it("changes nothing without a declared tier or on other protocols", () => {
    const options: Options = {};
    expect(withBackgroundServiceTier(options, { api: "openai-responses" }, undefined)).toBe(
      options,
    );
    expect(withBackgroundServiceTier(options, { api: "anthropic-messages" }, "flex")).toBe(options);
  });

  it("keeps a tier already in the payload and an earlier hook's replacement", async () => {
    const out = withBackgroundServiceTier<Options>(
      { onPayload: async () => ({ replaced: true }) },
      { api: "openai-responses" },
      "flex",
    );
    expect(await run(out, {})).toEqual({ replaced: true, service_tier: "flex" });
    const kept = withBackgroundServiceTier<Options>(undefined, { api: "openai-responses" }, "flex");
    expect(await run(kept, { service_tier: "priority" })).toEqual({ service_tier: "priority" });
  });
});
