import { describe, expect, it, vi } from "vitest";

const record = vi.fn(async () => true);
vi.mock("@corvo/db", () => ({
  runAsSystem: async (_why: string, work: () => Promise<unknown>) => work(),
  recordAssistantUnavailable: (...args: unknown[]) => record(...(args as [])),
}));

import { alertPartnerOfSetupFailure } from "./partner-run-alerts.js";

const deps = (organizationId: string | null) =>
  ({
    prisma: {
      space: { findUnique: async () => (organizationId ? { organizationId } : null) },
    },
  }) as never;

describe("telling a partner its customer's assistant is unavailable", () => {
  it.each([
    ["no_model_access", "no_model"],
    ["model_credits_empty", "credits_empty"],
    ["model_unpriced", "model_unpriced"],
    ["model_not_allowed", "model_not_allowed"],
  ] as const)("notes %s as %s", async (code, cause) => {
    record.mockClear();
    await alertPartnerOfSetupFailure(deps("org-1"), "space-1", { code });
    expect(record).toHaveBeenCalledWith(expect.anything(), "org-1", cause);
  });

  it("ignores failures that are not the account's setup", async () => {
    record.mockClear();
    await alertPartnerOfSetupFailure(deps("org-1"), "space-1", { code: "model_rate_limited" });
    await alertPartnerOfSetupFailure(deps("org-1"), "space-1", { code: "unknown" });
    expect(record).not.toHaveBeenCalled();
  });

  it("never throws into a run's failure handling", async () => {
    record.mockRejectedValueOnce(new Error("db down"));
    await expect(
      alertPartnerOfSetupFailure(deps("org-1"), "space-1", { code: "no_model_access" }),
    ).resolves.toBeUndefined();
    await expect(
      alertPartnerOfSetupFailure(deps(null), "space-1", { code: "no_model_access" }),
    ).resolves.toBeUndefined();
  });
});
