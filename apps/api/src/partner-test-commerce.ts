import type { SubscriptionInput } from "@corvo/db";

/**
 * What the commerce API answers a test key. Nothing is recorded: no credit lot, no revenue row, no
 * invoice and no payment at the provider. The answers have the shape of the live ones, so a
 * partner can build and check its whole flow, and carry `test: true` so they cannot be mistaken.
 */

/** Credit a test customer is shown for its plan, in the partner's minor units. */
const SIMULATED_PLAN_CREDIT_MINOR = 10_000;

export function simulatedSubscription(
  tenantId: string,
  currency: string,
  input: Pick<SubscriptionInput, "plan" | "status" | "currentPeriodStart">,
) {
  return {
    test: true,
    tenantId,
    plan: input.plan,
    status: input.status,
    period: input.currentPeriodStart.toISOString().slice(0, 7),
    credit: {
      currency,
      grantedMinor: SIMULATED_PLAN_CREDIT_MINOR,
      usedMinor: 0,
      remainingMinor: input.status === "canceled" ? 0 : SIMULATED_PLAN_CREDIT_MINOR,
    },
    rookShareMinor: 0,
  };
}

export function simulatedTopup(currency: string, creditMinor: number, idempotencyKey: string) {
  return {
    test: true,
    topupId: `test_topup_${idempotencyKey}`,
    creditMinor,
    balance: { currency, remainingMinor: SIMULATED_PLAN_CREDIT_MINOR + creditMinor },
    rookShareMinor: 0,
  };
}

export function simulatedRefund(currency: string, refundedMinor: number, idempotencyKey: string) {
  return {
    test: true,
    refundId: `test_refund_${idempotencyKey}`,
    currency,
    refundedMinor,
    reversed: { baseMinor: 0, rookShareMinor: 0, partnerCommissionMinor: 0, markupMinor: 0 },
    creditRemovedMinor: 0,
  };
}

export function simulatedBalance(currency: string, now: Date) {
  return {
    test: true,
    currency,
    period: now.toISOString().slice(0, 7),
    state: "active",
    plan: {
      grantedMinor: SIMULATED_PLAN_CREDIT_MINOR,
      usedMinor: 0,
      remainingMinor: SIMULATED_PLAN_CREDIT_MINOR,
      expiresAt: null,
    },
    topup: { remainingMinor: 0 },
    remainingMinor: SIMULATED_PLAN_CREDIT_MINOR,
    fxRate: null,
  };
}

export function simulatedUsage(currency: string, period: string) {
  return { test: true, period, currency, usedMinor: 0, byDay: [] };
}
