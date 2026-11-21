import { AGENT_LOADER_WORKING_AFTER_MS } from "@corvo/core";
import { describe, expect, it } from "vitest";
import { agentLoaderMotion } from "./agent-loader";

describe("agentLoaderMotion", () => {
  it("works faster and fuller than it thinks", () => {
    const thinking = agentLoaderMotion(false);
    const working = agentLoaderMotion(true);
    expect(working.periodMs).toBeLessThan(thinking.periodMs);
    expect(working.scale).toBeGreaterThan(thinking.scale);
  });

  it("turns from thinking to working after the shared threshold", () => {
    expect(AGENT_LOADER_WORKING_AFTER_MS).toBe(1_500);
  });
});
