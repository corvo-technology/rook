import { describe, expect, it } from "vitest";
import { newAgentModelAuto } from "./model-auto.js";

describe("newAgentModelAuto", () => {
  it("makes a new agent automatic where the deployment set up a tier", () => {
    expect(newAgentModelAuto({ modelId: null, env: { PI_FAST_MODEL: "cheap" } })).toBe(true);
    expect(newAgentModelAuto({ modelId: null, env: { PI_STRONG_MODEL: "big" } })).toBe(true);
    expect(
      newAgentModelAuto({
        modelId: null,
        settings: { fastModelId: null, strongModelId: "big" },
        env: {},
      }),
    ).toBe(true);
  });

  it("leaves an agent on the default model where no tier is set up", () => {
    expect(newAgentModelAuto({ modelId: null, env: {} })).toBe(false);
    expect(
      newAgentModelAuto({
        modelId: null,
        settings: { fastModelId: null, strongModelId: null },
        env: { PI_FAST_MODEL: " " },
      }),
    ).toBe(false);
  });

  it("never overrides a model that was chosen or inherited", () => {
    expect(newAgentModelAuto({ modelId: "pinned", env: { PI_FAST_MODEL: "cheap" } })).toBe(false);
    expect(newAgentModelAuto({ modelId: "pinned", requested: true, env: {} })).toBe(false);
  });

  it("follows an explicit request or the parent agent", () => {
    expect(
      newAgentModelAuto({ modelId: null, requested: false, env: { PI_FAST_MODEL: "c" } }),
    ).toBe(false);
    expect(newAgentModelAuto({ modelId: null, requested: true, env: {} })).toBe(true);
    expect(newAgentModelAuto({ modelId: null, parentAuto: true, env: {} })).toBe(true);
  });
});
