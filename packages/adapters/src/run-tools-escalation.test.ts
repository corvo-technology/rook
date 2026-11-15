import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "./run-context.js";
import { taskTools } from "./run-tools-tasks.js";

function context(overrides: { strongerTier?: "main" | "strong" | null; tierEscalations?: number }) {
  const abort = vi.fn();
  const ctx = {
    run: { tierEscalations: overrides.tierEscalations ?? 0 },
    abortController: { abort },
    state: {
      strongerTier: overrides.strongerTier === undefined ? "strong" : overrides.strongerTier,
      escalation: undefined as { reason: string } | undefined,
    },
  } as unknown as RunContext;
  return { ctx, abort };
}
const requestStrongerModel = taskTools.request_stronger_model!;
const call = (args: Record<string, unknown>) =>
  ({ args, finish: (result: unknown) => result }) as unknown as Parameters<
    typeof requestStrongerModel
  >[1];

describe("request_stronger_model", () => {
  it("ends the turn and keeps a short reason for the run", async () => {
    const { ctx, abort } = context({});
    const result = await requestStrongerModel(ctx, call({ reason: "  a proof\nneeded " }));
    expect(result).toMatchObject({ ok: true });
    expect(ctx.state.escalation).toEqual({ reason: "a proof needed" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("refuses a second request in the same turn", async () => {
    const { ctx, abort } = context({});
    await requestStrongerModel(ctx, call({ reason: "first" }));
    const second = await requestStrongerModel(ctx, call({ reason: "second" }));
    expect(second).toHaveProperty("error");
    expect(ctx.state.escalation).toEqual({ reason: "first" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("refuses when there is no stronger tier to ask for, such as the top tier or a pinned agent", async () => {
    const { ctx, abort } = context({ strongerTier: null });
    expect(await requestStrongerModel(ctx, call({ reason: "hard" }))).toHaveProperty("error");
    expect(ctx.state.escalation).toBeUndefined();
    expect(abort).not.toHaveBeenCalled();
  });

  it("refuses a run that already moved up a tier", async () => {
    const { ctx } = context({ tierEscalations: 1 });
    expect(await requestStrongerModel(ctx, call({}))).toHaveProperty("error");
    expect(ctx.state.escalation).toBeUndefined();
  });
});
