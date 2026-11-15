import type { AgentRuntimeEvent } from "@corvo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { escalateRunTier } from "./run-lifecycle.js";
import {
  classifyTier,
  resolveTierModel,
  routeRunTier,
  routeTurn,
  strongerTierFor,
} from "./run-model-routing.js";

const fast = vi.hoisted(() => ({ model: undefined as unknown }));
vi.mock("./run-model.js", () => ({
  resolveFastRunModel: vi.fn(async () => fast.model),
  deploymentModelDefaults: vi.fn(),
}));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal()),
  recordUsage: vi.fn(async () => undefined),
}));

const scope = { id: "run-1", spaceId: "space-1", userId: "user-1", botId: "bot-1" };
const defaults = {
  deployment: { provider: "cloud", model: "standard", fastModel: "cheap", strongModel: "big" },
};

function deps(opts: { answer?: string; fails?: boolean; roles?: Array<{ role: string }> } = {}) {
  const run = vi.fn(async function* (): AsyncGenerator<AgentRuntimeEvent> {
    if (opts.fails) throw new Error("model down");
    yield { type: "done", text: opts.answer ?? "" } as AgentRuntimeEvent;
  });
  const rows = (opts.roles ?? []).map((row) => ({
    position: 0,
    provider: "member",
    modelId: `member-${row.role}`,
    thinkingLevel: null,
    credentialId: null,
    ...row,
  }));
  return {
    run,
    deps: {
      runtime: { run },
      prisma: {
        spaceSettingOverride: { findUnique: vi.fn(async () => null) },
        userModelRoleChoice: {
          findMany: vi.fn(async ({ where }: { where: { role: string } }) =>
            rows.filter((row) => row.role === where.role),
          ),
        },
      },
    } as unknown as ExecutorDeps,
  };
}

beforeEach(() => {
  fast.model = undefined;
});

describe("tier models", () => {
  it("runs the main tier on whatever main model the run already resolves", async () => {
    expect(await resolveTierModel(deps().deps, scope, "main", defaults)).toEqual({
      tier: "main",
      choice: null,
      fromDeployment: false,
    });
  });

  it("uses the deployment's models for the other tiers", async () => {
    expect(await resolveTierModel(deps().deps, scope, "fast", defaults)).toMatchObject({
      tier: "fast",
      choice: { modelProvider: "cloud", modelId: "cheap" },
      fromDeployment: true,
    });
  });

  it("prefers a member's own model for a tier over the deployment's", async () => {
    const routed = await resolveTierModel(
      deps({ roles: [{ role: "strong" }] }).deps,
      scope,
      "strong",
      defaults,
    );
    expect(routed).toMatchObject({
      choice: { modelProvider: "member", modelId: "member-strong" },
      fromDeployment: false,
    });
  });

  it("serves a tier nobody configured from the main model", async () => {
    expect(await resolveTierModel(deps().deps, scope, "strong", {})).toEqual({
      tier: "main",
      choice: null,
      fromDeployment: false,
    });
  });
});

describe("classifyTier", () => {
  it("is skipped without a fast model, so an unsettled turn stays on the main tier", async () => {
    const { deps: d, run } = deps({ answer: "strong" });
    expect(await classifyTier(d, scope, "do the thing")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("asks once, tool-less and capped, and reads one tier word", async () => {
    fast.model = { provider: "cloud", id: "cheap" };
    const { deps: d, run } = deps({ answer: "strong" });
    expect(await classifyTier(d, scope, "x".repeat(10_000))).toBe("strong");
    expect(run).toHaveBeenCalledOnce();
    const request = (
      run.mock.calls[0] as unknown as [
        { tools: unknown[]; prompt: string; model: { maxTokens: number } },
      ]
    )[0];
    expect(request.tools).toEqual([]);
    expect(request.prompt.length).toBeLessThanOrEqual(1_500);
    expect(request.model.maxTokens).toBeLessThanOrEqual(16);
  });

  it("treats a failed or unclear answer as no answer", async () => {
    fast.model = { provider: "cloud", id: "cheap" };
    expect(await classifyTier(deps({ fails: true }).deps, scope, "hi")).toBeNull();
    expect(await classifyTier(deps({ answer: "it depends" }).deps, scope, "hi")).toBeNull();
  });
});

describe("routeRunTier", () => {
  const signals = {
    title: "Helper",
    description: "",
    trigger: "user" as const,
    prompt: "tidy this up",
    contextTokens: 100,
    attachments: 0,
    approvalGated: false,
  };

  it("pays for the classifier only when the signals do not settle the turn", async () => {
    fast.model = { provider: "cloud", id: "cheap" };
    const settled = deps({ answer: "fast" });
    await routeRunTier(settled.deps, scope, { ...signals, title: "Developer" }, defaults);
    expect(settled.run).not.toHaveBeenCalled();
    const unsettled = deps({ answer: "strong" });
    expect(await routeRunTier(unsettled.deps, scope, signals, defaults)).toMatchObject({
      tier: "strong",
    });
    expect(unsettled.run).toHaveBeenCalledOnce();
  });

  it("never classifies an escalated run, which starts on its floor", async () => {
    fast.model = { provider: "cloud", id: "cheap" };
    const { deps: d, run } = deps({ answer: "fast" });
    await routeRunTier(d, scope, { ...signals, floor: "strong" }, defaults);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("routeTurn", () => {
  const run = {
    ...scope,
    trigger: "user",
    checkpoint: null,
    modelTier: null,
    tierEscalations: 0,
  };
  const input = {
    bot: { title: "Inbox triage", description: "Sorts email" },
    task: { prompt: "Sort the new mail" },
    messages: [],
    defaults,
  };

  it("keeps the tier a run settled on, so a retried attempt decides nothing again", async () => {
    const { deps: d, run: model } = deps();
    expect(
      await routeTurn({ ...input, deps: d, run: { ...run, modelTier: "strong" } }),
    ).toMatchObject({ tier: "strong", choice: { modelId: "big" } });
    expect(model).not.toHaveBeenCalled();
  });

  it("starts an agent made for triage on the fast tier, and a resumed approval on main or higher", async () => {
    const { deps: d } = deps();
    expect(await routeTurn({ ...input, deps: d, run })).toMatchObject({ tier: "fast" });
    expect(
      await routeTurn({ ...input, deps: d, run: { ...run, trigger: "resume" } }),
    ).toMatchObject({ tier: "main" });
  });
});

describe("strongerTierFor", () => {
  const strongRole = [{ role: "strong" }];
  const run = { ...scope, tierEscalations: 0 };

  it("offers the next tier up when it has a model of its own", async () => {
    expect(await strongerTierFor(deps().deps, run, "fast", defaults)).toBe("main");
    expect(await strongerTierFor(deps().deps, run, "main", defaults)).toBe("strong");
  });

  it("offers nothing from the strongest tier", async () => {
    expect(await strongerTierFor(deps().deps, run, "strong", defaults)).toBeNull();
  });

  it("offers nothing when the next tier would only be the main model again", async () => {
    expect(
      await strongerTierFor(deps({ roles: strongRole }).deps, run, "main", { deployment: null }),
    ).toBe("strong");
    expect(await strongerTierFor(deps().deps, run, "main", { deployment: null })).toBeNull();
  });

  it("offers nothing to a run that already moved up, or one without a tier (a pinned agent)", async () => {
    expect(
      await strongerTierFor(deps().deps, { ...run, tierEscalations: 1 }, "fast", defaults),
    ).toBeNull();
    expect(await strongerTierFor(deps().deps, run, undefined, defaults)).toBeNull();
  });
});

describe("escalateRunTier", () => {
  function lifecycle(count: number) {
    const updateMany = vi.fn(async () => ({ count }));
    const enqueue = vi.fn(async () => undefined);
    return {
      updateMany,
      enqueue,
      deps: { prisma: { run: { updateMany } }, jobs: { enqueue } } as unknown as ExecutorDeps,
    };
  }

  it("requeues the run once on the next tier and records it", async () => {
    const { deps: d, updateMany, enqueue } = lifecycle(1);
    expect(await escalateRunTier(d, "run-1", "worker", 3, "main")).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "running",
        leaseOwner: "worker",
        leaseFence: 3,
        tierEscalations: 0,
      },
      data: expect.objectContaining({
        status: "queued",
        modelTier: "main",
        tierEscalations: { increment: 1 },
      }),
    });
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("records why an agent's request moved the run, with its reason", async () => {
    const { deps: d, updateMany } = lifecycle(1);
    await escalateRunTier(d, "run-1", "worker", 3, "strong", {
      trigger: "agent_request",
      reason: "needs a proof",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          escalationTrigger: "agent_request",
          escalationReason: "needs a proof",
        }),
      }),
    );
  });

  it("refuses a second request from the same run", async () => {
    const { deps: d, enqueue } = lifecycle(0);
    expect(
      await escalateRunTier(d, "run-1", "worker", 3, "strong", { trigger: "agent_request" }),
    ).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does nothing for a run that already escalated or whose lease moved on", async () => {
    const { deps: d, enqueue } = lifecycle(0);
    expect(await escalateRunTier(d, "run-1", "worker", 3, "strong")).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
