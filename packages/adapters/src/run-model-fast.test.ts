import { describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { resolveFastRunModel } from "./run-model.js";

const scope = { userId: "user-1", spaceId: "space-1" };

function deps(rows: Array<{ role: string; position: number; provider: string; modelId: string }>) {
  const findMany = vi.fn(async ({ where }: { where: { role: string } }) =>
    rows
      .filter((row) => row.role === where.role)
      .map((row) => ({ thinkingLevel: null, credentialId: null, ...row })),
  );
  return {
    deps: {
      deploymentModelConfigured: false,
      prisma: {
        deploymentSettings: { findUnique: vi.fn(async () => null) },
        spaceSettingOverride: { findUnique: vi.fn(async () => null) },
        userModelRoleChoice: { findMany },
      },
    } as unknown as ExecutorDeps,
    findMany,
  };
}

describe("resolveFastRunModel", () => {
  it("is undefined when the member chose no fast model, so chores use the main one", async () => {
    const { deps: d, findMany } = deps([
      { role: "main", position: 0, provider: "anthropic", modelId: "big" },
    ]);
    expect(await resolveFastRunModel(d, scope)).toBeUndefined();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { role: "fast" } });
  });

  it("is undefined, not an error, when the chosen fast model cannot run", async () => {
    const { deps: d } = deps([
      { role: "fast", position: 0, provider: "deepseek", modelId: "deepseek-chat" },
    ]);
    // No connection or secret store behind it, so resolving its key fails.
    expect(await resolveFastRunModel(d, scope)).toBeUndefined();
  });
});
