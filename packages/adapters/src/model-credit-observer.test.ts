import type { ModelCallObserver } from "@corvo/adapter-kit";
import { PARTNER_CREDIT_USED_UP_RUN_ERROR, PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR } from "@corvo/core";
import {
  assertPartnerSpendAllowed,
  creditAccount,
  organizationForMember,
  PartnerSpendRefused,
  reserveModelCredits,
} from "@corvo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedModelCreditObserver } from "./model-credit-observer.js";

vi.mock("@corvo/db", () => ({
  organizationForMember: vi.fn(),
  creditAccount: vi.fn(),
  reserveModelCredits: vi.fn(),
  recordModelCreditReceipt: vi.fn(),
  assertPartnerSpendAllowed: vi.fn(),
  PartnerSpendRefused: class extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
}));

const scope = { userId: "user-1", spaceId: "space-1" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationForMember).mockResolvedValue({ organizationId: "org-1" } as never);
});

describe("hosted model credit gate", () => {
  it("refuses BYOK accounts even if old owner and subscription records exist", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "byok" } as never);
    const findUnique = vi.fn(async () => ({ ownerUserId: scope.userId, status: "active" }));
    await expect(
      hostedModelCreditObserver(
        { deploymentSettings: { findUnique }, billingAccount: { findUnique } } as never,
        scope,
      ),
    ).rejects.toThrow("Connect your own API key");
    expect(findUnique).not.toHaveBeenCalled();
    expect(reserveModelCredits).not.toHaveBeenCalled();
  });
  it("requires a reservation before a funded-mode account may use the server key", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "credits" } as never);
    vi.mocked(reserveModelCredits).mockRejectedValue(new Error("Not enough model credits"));
    const observer = await hostedModelCreditObserver({} as never, scope);
    const call = {
      callId: "call-1",
      maxCostUsd: 0.02,
      provider: "test-provider",
      modelId: "test-model",
      runId: "run-1",
    } as Parameters<ModelCallObserver["beforeCall"]>[0];
    await expect(observer.beforeCall(call)).rejects.toThrow("Not enough model credits");
    expect(reserveModelCredits).toHaveBeenCalledWith({}, "org-1", 0.02, {
      ...scope,
      callId: "call-1",
      runId: "run-1",
      provider: "test-provider",
      model: "test-model",
    });
  });
});

describe("a partner's rules on Rook-provided models", () => {
  const call = {
    callId: "call-2",
    maxCostUsd: 0.02,
    provider: "test-provider",
    modelId: "test-model",
    runId: "run-1",
  } as Parameters<ModelCallObserver["beforeCall"]>[0];

  it("stops a call from a customer at its limit, with the coded message, before any credit is taken", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "credits" } as never);
    const observer = await hostedModelCreditObserver({} as never, scope);
    vi.mocked(assertPartnerSpendAllowed).mockRejectedValueOnce(
      new PartnerSpendRefused("credit_limit_reached"),
    );
    await expect(observer.beforeCall(call)).rejects.toThrow(PARTNER_CREDIT_USED_UP_RUN_ERROR);
    expect(reserveModelCredits).not.toHaveBeenCalled();
  });

  it("refuses a model the partner did not allow, before the run starts", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "credits" } as never);
    vi.mocked(assertPartnerSpendAllowed).mockRejectedValueOnce(
      new PartnerSpendRefused("model_not_allowed"),
    );
    await expect(
      hostedModelCreditObserver({} as never, scope, { provider: "p", id: "m" }),
    ).rejects.toThrow(PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR);
    expect(assertPartnerSpendAllowed).toHaveBeenCalledWith({}, "org-1", {
      provider: "p",
      model: "m",
    });
  });
});
