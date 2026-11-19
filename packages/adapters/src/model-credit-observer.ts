import type { ModelCallObserver } from "@corvo/adapter-kit";
import {
  HOSTED_MODEL_CREDITS_REQUIRED_ERROR,
  PARTNER_CREDIT_USED_UP_RUN_ERROR,
  PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR,
} from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import {
  assertPartnerSpendAllowed,
  creditAccount,
  organizationForMember,
  PartnerSpendRefused,
  recordModelCreditReceipt,
  reserveModelCredits,
} from "@corvo/db";

export class HostedModelCreditsRequiredError extends Error {}

/** A partner's customer asked Rook-provided AI for a model or an amount its partner does not allow. */
export class PartnerSpendRefusedError extends Error {
  constructor(readonly reason: PartnerSpendRefused["reason"]) {
    super(
      reason === "model_not_allowed"
        ? PARTNER_MODEL_NOT_ALLOWED_RUN_ERROR
        : PARTNER_CREDIT_USED_UP_RUN_ERROR,
    );
    this.name = "PartnerSpendRefusedError";
  }
}

async function assertPartnerAllows(
  prisma: PrismaClient,
  organizationId: string,
  call: { provider?: string; model?: string },
) {
  try {
    await assertPartnerSpendAllowed(prisma, organizationId, call);
  } catch (error) {
    if (error instanceof PartnerSpendRefused) throw new PartnerSpendRefusedError(error.reason);
    throw error;
  }
}

/**
 * Only deployment credentials are metered; a personal connection never reaches this boundary, so
 * a customer's own key, a local model or its own CLI plan is never debited or blocked here.
 */
export async function hostedModelCreditObserver(
  prisma: PrismaClient,
  scope: { userId: string; spaceId: string },
  /** The model about to run, so a partner's rules apply before the run starts. */
  model?: { provider: string; id: string },
): Promise<ModelCallObserver> {
  const membership = await organizationForMember(prisma, scope);
  if (!membership) throw new Error("Model credit account is unavailable");
  const account = await creditAccount(prisma, membership.organizationId);
  if (account.mode !== "credits")
    throw new HostedModelCreditsRequiredError(HOSTED_MODEL_CREDITS_REQUIRED_ERROR);
  await assertPartnerAllows(prisma, membership.organizationId, {
    provider: model?.provider,
    model: model?.id,
  });
  return {
    beforeCall: async (call) => {
      // The limit can be crossed in the middle of a run, so every call is checked again.
      await assertPartnerAllows(prisma, membership.organizationId, {
        provider: call.provider,
        model: call.modelId,
      });
      return reserveModelCredits(prisma, membership.organizationId, call.maxCostUsd ?? Number.NaN, {
        callId: call.callId,
        userId: scope.userId,
        spaceId: scope.spaceId,
        runId: call.runId,
        provider: call.provider,
        model: call.modelId,
      });
    },
    afterCall: (reservationId, usage) => recordModelCreditReceipt(prisma, reservationId, usage),
    onRequestId: async (id, providerRequestId) => {
      await prisma.modelCreditEntry.updateMany({
        where: { id, providerRequestId: null },
        data: { providerRequestId },
      });
    },
  };
}
